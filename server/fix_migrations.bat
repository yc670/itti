@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  Reconciling alembic_version with the real schema.
echo  Tested end-to-end against a simulation of this exact
echo  drifted state before being handed to you - see the
echo  conversation this came from for the full verification.
echo ============================================================
echo.
echo  This does NOT delete or modify any existing data - it only
echo  adds columns/indexes/tables that are genuinely missing, and
echo  marks as "already done" the ones that already exist.
echo.
echo  Make sure you've already backed up app.db before continuing.
echo.
pause

echo.
echo === Step 1/9: stamp fcca6582f99d (fellows table - already exists, no SQL run) ===
call alembic stamp fcca6582f99d
if errorlevel 1 goto :failed

echo.
echo === Step 2/9: upgrade 8ec7a9f38009 (add ix_reports_category - real DDL) ===
call alembic upgrade 8ec7a9f38009
if errorlevel 1 goto :failed

echo.
echo === Step 3/9: stamp 635cd82587f6 (notifications table - already exists, no SQL run) ===
call alembic stamp 635cd82587f6
if errorlevel 1 goto :failed

echo.
echo === Step 4/9: stamp 9dd9f4e91099 (password_reset_codes table - already exists, no SQL run) ===
call alembic stamp 9dd9f4e91099
if errorlevel 1 goto :failed

echo.
echo === Step 5/9: upgrade c1a9ddadbaec (add 3 reports columns - real DDL) ===
call alembic upgrade c1a9ddadbaec
if errorlevel 1 goto :failed

echo.
echo === Step 6/9: upgrade 8797e68b757e (add users.email_verified - real DDL) ===
call alembic upgrade 8797e68b757e
if errorlevel 1 goto :failed

echo.
echo === Step 7/9: upgrade 9be8486b4b71 (add composite reports index - real DDL) ===
call alembic upgrade 9be8486b4b71
if errorlevel 1 goto :failed

echo.
echo === Step 8/9: upgrade fe0cfad5b3ab (add composite notifications index - real DDL) ===
call alembic upgrade fe0cfad5b3ab
if errorlevel 1 goto :failed

echo.
echo === Step 9/9: upgrade head (merge point, no-op) ===
call alembic upgrade head
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  SUCCESS. Verifying final state:
echo ============================================================
call alembic current
echo.
echo Expect to see: 6086ae6619bc (head) (mergepoint)
goto :end

:failed
echo.
echo ============================================================
echo  STOPPED - a step failed. Nothing after this point ran.
echo  Do NOT re-run this script yet - the database is now in a
echo  partial state. Run "alembic current" and share the output,
echo  along with whatever error printed above, before continuing.
echo ============================================================
exit /b 1

:end
endlocal
