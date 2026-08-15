"""
Generic schema-drift repair: compares the live database against the
current SQLAlchemy models (every table registered on Base.metadata)
and adds whatever is missing - tables, columns, single-column indexes
- without touching anything that already exists. Safe to point at any
DATABASE_URL (sqlite or Postgres) and run any time you suspect drift,
not just for the one incident this was originally written for.

Why this can happen at all: app.py runs Base.metadata.create_all() on
every restart when DATABASE_URL is sqlite (see app.py's startup
block) - which only creates brand-new tables, it never alters an
existing one - while Alembic's migration history (alembic_version) is
tracked completely separately and can independently claim to be
further ahead than the live schema actually is. Whenever those two
sources of truth diverge, an existing table can end up missing
columns/indexes its own model declares, invisible until a query hits
the gap - see docs/DEPLOYMENT.md for the specific incident this was
first written for (GET /api/reports 500ing on the ittiglobal.org
droplet because `reports` was missing 5 columns despite
alembic_version claiming otherwise).

Deliberately conservative:
  - Only ADDS things that are missing. Never drops, renames, or alters
    an existing column's type/nullability/constraints - if a column
    exists but with the wrong type, that needs a real Alembic
    migration (op.batch_alter_table on SQLite), not this script.
  - A brand-new missing TABLE is created via
    Base.metadata.create_all(engine, tables=[...]), scoped to just that
    table, so it comes out with every column/index the model declares
    in one shot - not built column-by-column like an existing table's
    gaps are.
  - For a missing COLUMN on an existing table: neither SQLite nor
    Postgres can add a NOT NULL column to a table that already has
    rows without also supplying a value for those existing rows in the
    same breath - and the ORM-level `default=` this codebase's models
    use (as opposed to `server_default=`) never appears in the DDL at
    all, so there's nothing for either database to backfill with
    automatically. So on both dialects, every added column is always
    created nullable first, then:
      - existing rows are backfilled via UPDATE using the model's
        default, where one can be determined safely:
          - a plain scalar Python-side `default=` -> that literal value
          - a `server_default=` -> that expression, as-is
          - a callable `default=` (e.g. `default=datetime.utcnow`) on a
            Date/DateTime column -> CURRENT_TIMESTAMP, since "now" is
            what that pattern means everywhere it's used here
          - anything else -> left NULL, with a printed warning, rather
            than silently guessing a value that might be wrong
      - if the model declares the column NOT NULL and a backfill value
        was found, Postgres gets a follow-up
        ALTER TABLE ... ALTER COLUMN ... SET NOT NULL to actually
        finish enforcing that constraint at the database level.
        SQLite has no equivalent (no ALTER COLUMN at all) - the
        column stays nullable in the live SQLite schema even though
        the model says otherwise; the ORM always supplies a value on
        insert/update regardless, so this is safe in practice, just
        not as strictly enforced as the model claims.
  - Does NOT touch alembic_version. Run `alembic stamp head` yourself
    right after, once you've confirmed the output looks right - keep
    that a visible, deliberate step rather than something this script
    decides silently on your behalf.

Usage:
    python fix_reports_schema.py                # apply
    python fix_reports_schema.py --dry-run       # report only, no changes
"""
import sys

from sqlalchemy import inspect, text
from sqlalchemy.schema import CreateColumn

from models.database import Base, engine, DATABASE_URL

# Import every model module so its table registers onto Base.metadata -
# importing app.py would also work but drags in Flask/routes we don't
# need here, and this way the script has no Flask dependency at all.
import models.user                  # noqa: F401
import models.report                # noqa: F401
import models.report_review         # noqa: F401
import models.notification          # noqa: F401
import models.favorite_report       # noqa: F401
import models.fellow                # noqa: F401
import models.document              # noqa: F401
import models.saved_chart           # noqa: F401
import models.donation              # noqa: F401
import models.enrollment            # noqa: F401
import models.user_event            # noqa: F401
import models.password_reset_token  # noqa: F401
import models.password_reset_code   # noqa: F401

IS_SQLITE = DATABASE_URL.startswith("sqlite")


def _column_ddl(column, dialect):
    """Renders a bare 'name TYPE' fragment for ALTER TABLE ADD COLUMN -
    always nullable, regardless of what the model declares or which
    dialect this is. See module docstring for why NOT NULL is never
    included here; _finish_not_null() below is what (on Postgres)
    actually enforces it, once there's a value to backfill with."""
    rendered = str(CreateColumn(column).compile(dialect=dialect)).strip()
    return rendered.replace(" NOT NULL", "")


def _backfill_expr(column, dialect):
    """
    Returns a SQL expression to backfill existing rows for a newly
    added column, or None if there's no safe way to derive one - see
    module docstring for the precedence used.
    """
    if column.server_default is not None:
        arg = column.server_default.arg
        return str(arg.compile(dialect=dialect)) if hasattr(arg, "compile") else str(arg)
    if column.default is not None:
        if column.default.is_scalar:
            return repr(column.default.arg)
        if type(column.type).__name__ in ("DateTime", "Date"):
            return "CURRENT_TIMESTAMP"
    return None


def main():
    dry_run = "--dry-run" in sys.argv
    dialect = engine.dialect
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    changes = []
    warnings = []

    with engine.connect() as conn:
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                print(f"[table]  {table_name} missing entirely -> creating (with all its columns/indexes)")
                changes.append(f"create_table:{table_name}")
                if not dry_run:
                    Base.metadata.create_all(engine, tables=[table])
                continue  # a freshly created table already has every column/index

            existing_columns = {c["name"] for c in inspector.get_columns(table_name)}
            existing_indexes = {i["name"] for i in inspector.get_indexes(table_name)}

            for column in table.columns:
                if column.name in existing_columns:
                    continue
                ddl_fragment = _column_ddl(column, dialect)
                stmt = f"ALTER TABLE {table_name} ADD COLUMN {ddl_fragment}"
                print(f"[column] {table_name}.{column.name} missing -> {stmt}")
                changes.append(stmt)
                if not dry_run:
                    conn.execute(text(stmt))

                if not column.nullable:
                    backfill_expr = _backfill_expr(column, dialect)
                    if backfill_expr is not None:
                        backfill = (
                            f"UPDATE {table_name} SET {column.name} = {backfill_expr} "
                            f"WHERE {column.name} IS NULL"
                        )
                        print(f"[backfill] {backfill}")
                        if not dry_run:
                            conn.execute(text(backfill))

                        if not IS_SQLITE:
                            not_null_stmt = (
                                f"ALTER TABLE {table_name} ALTER COLUMN {column.name} SET NOT NULL"
                            )
                            print(f"[constraint] {not_null_stmt}")
                            if not dry_run:
                                conn.execute(text(not_null_stmt))
                    else:
                        msg = (
                            f"{table_name}.{column.name} is NOT NULL in the model but has no "
                            "default this script can safely infer - added as nullable, existing "
                            "rows left NULL. Review and backfill manually."
                        )
                        print(f"[warn]   {msg}")
                        warnings.append(msg)

            for column in table.columns:
                if not (column.index or column.unique):
                    continue
                index_name = f"ix_{table_name}_{column.name}"
                if index_name in existing_indexes:
                    continue
                unique_kw = "UNIQUE " if column.unique else ""
                stmt = f"CREATE {unique_kw}INDEX {index_name} ON {table_name} ({column.name})"
                print(f"[index]  {index_name} missing -> {stmt}")
                changes.append(stmt)
                if not dry_run:
                    conn.execute(text(stmt))

        if not dry_run:
            conn.commit()

    print()
    if not changes:
        print("Nothing to do - live schema already matches the models. Safe to `alembic stamp head`.")
    else:
        verb = "Would apply" if dry_run else "Applied"
        print(f"{verb} {len(changes)} change(s) against {DATABASE_URL}.")
        if not dry_run:
            print("Next: run `alembic current` and `alembic heads` to confirm, then `alembic stamp head`.")
    if warnings:
        print(f"\n{len(warnings)} column(s) need a manual look - see [warn] lines above.")


if __name__ == "__main__":
    main()