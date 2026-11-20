@echo off
 Bucksy Database Setup Script
 This script helps set up the D1 database for Cloudflare Pages

echo 🚀 Setting up Bucksy database...

:: Check if wrangler is installed
wrangler --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Wrangler is not installed. Please install it first:
    echo    npm install -g wrangler
    pause
    exit /b 1
)

:: Check if user is logged in
echo 🔐 Checking Wrangler login...
wrangler whoami
if %errorlevel% neq 0 (
    echo ❌ Please login to Wrangler first:
    echo    wrangler login
    pause
    exit /b 1
)

:: Create D1 database if it doesn't exist
echo 📊 Checking if database exists...
wrangler d1 list | findstr "bucksy-db" >nul
if %errorlevel% neq 0 (
    echo Creating new D1 database...
    wrangler d1 create bucksy-db
    echo ✅ Database created!
    
    :: Get the database ID
    for /f "tokens=2" %%i in ('wrangler d1 list ^| findstr "bucksy-db"') do set DB_ID=%%i
    echo 📍 Database ID: %DB_ID%
    
    :: Update wrangler.toml with the actual database ID
    (echo database_id = "%DB_ID%") > temp_id.txt
    powershell -Command "(Get-Content wrangler.toml) -replace 'database_id = \"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\"', (Get-Content temp_id.txt) | Set-Content wrangler.toml"
    del temp_id.txt
    echo ✅ Updated wrangler.toml with database ID
) else (
    echo ✅ Database already exists
)

:: Apply migrations
echo 🔧 Applying database migrations...

:: Apply waitlist migration
echo Applying waitlist migration...
wrangler d1 execute bucksy-db --file=./migrations/0006_waitlist.sql

:: Apply verification migration
echo Applying verification migration...
wrangler d1 execute bucksy-db --file=./migrations/0007_waitlist_verification_sent_at.sql

:: Apply email logs migration
echo Applying email logs migration...
wrangler d1 execute bucksy-db --file=./migrations/0008_email_logs.sql

:: Apply admin tables migration
echo Applying admin tables migration...
wrangler d1 execute bucksy-db --file=./migrations/0009_admin_tables.sql

echo ✅ All migrations applied!

:: Set environment variables
echo 🔑 Setting up environment variables...

:: Generate a secure admin token
for /f "tokens=*" %%a in ('openssl rand -base64 32') do set ADMIN_TOKEN=%%a
echo Generated admin token: %ADMIN_TOKEN%

:: Update pages.toml with environment variables
(
echo # Cloudflare Pages configuration for Bucksy project
echo.
echo [build]
echo command = "npm run build"  ^ Or your build command if you have one
echo.
echo [build.environment]
echo NODE_VERSION = "18"
echo.
echo # Environment variables
echo [env.production]
echo vars = { 
echo   ADMIN_TOKEN = "%ADMIN_TOKEN%",
echo   WAITLIST_EMAIL_PROVIDER = "resend",
echo   RESEND_API_KEY = "your_resend_api_key_here",
echo   WAITLIST_FROM_EMAIL = "noreply@bucksy.life"
echo }
) > pages.toml

echo ✅ Updated pages.toml with environment variables

:: Add sample data (optional)
echo 📝 Adding sample data...
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-1', 'user1@example.com', 'Alice Johnson', 'verified', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-2', 'user2@example.com', 'Bob Smith', 'pending', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-3', 'user3@example.com', 'Carol Davis', 'verified', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO admin_actions (id, admin_id, admin_email, action, data, created_at) VALUES ('sample-action-1', 'admin', 'admin@bucksy.life', 'Test dashboard access', '{}', 1698765432100);"

echo ✅ Sample data added!

echo.
echo 🎉 Setup complete!
echo.
echo Next steps:
echo 1. Update your email provider API key in pages.toml
echo 2. Deploy your Pages project:
echo    wrangler pages deploy
echo 3. Access the admin dashboard:
echo    https://your-domain.com/admin/login
echo.
echo Admin token: %ADMIN_TOKEN%
echo.
echo 💡 Tip: Save this admin token somewhere safe!

pause