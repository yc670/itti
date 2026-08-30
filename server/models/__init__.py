"""
Importing `models` (this package) guarantees every model class is
registered with SQLAlchemy's mapper, regardless of which one you actually
need. This matters because User.documents / User.events reference
Document and UserEvent by string name ("Document", "UserEvent") — if
those classes were never imported anywhere, SQLAlchemy can't resolve the
relationship and raises InvalidRequestError, even in code that only
touches User (see promote_user.py, which hits exactly this without this
file).
"""
from . import database  # noqa: F401
from . import user  # noqa: F401
from . import document  # noqa: F401
from . import user_event  # noqa: F401
from . import password_reset_token  # noqa: F401
from . import password_reset_code  # noqa: F401
from . import email_verification_code  # noqa: F401
from . import saved_chart  # noqa: F401
from . import report  # noqa: F401
from . import report_review  # noqa: F401
from . import donation  # noqa: F401
from . import favorite_report  # noqa: F401
from . import enrollment  # noqa: F401