#!/bin/bash

# Bucksy Database Setup Script
# This script helps set up the D1 database for Cloudflare Pages

echo "🚀 Setting up Bucksy database..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler is not installed. Please install it first:"
    echo "   npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
echo "🔐 Checking Wrangler login..."
wrangler whoami
if [ $? -ne 0 ]; then
    echo "❌ Please login to Wrangler first:"
    echo "   wrangler login"
    exit 1
fi

# Create D1 database if it doesn't exist
echo "📊 Creating D1 database..."
DB_EXISTS=$(wrangler d1 list | grep "bucksy-db" | wc -l)

if [ "$DB_EXISTS" -eq 0 ]; then
    echo "Creating new D1 database..."
    wrangler d1 create bucksy-db
    echo "✅ Database created!"
    
    # Get the database ID
    DB_ID=$(wrangler d1 list | grep "bucksy-db" | awk '{print $2}')
    echo "📍 Database ID: $DB_ID"
    
    # Update wrangler.toml with the actual database ID
    sed -i "s/database_id = \"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\"/database_id = \"$DB_ID\"/" wrangler.toml
    echo "✅ Updated wrangler.toml with database ID"
else
    echo "✅ Database already exists"
fi

# Apply migrations
echo "🔧 Applying database migrations..."

# Apply waitlist migration
echo "Applying waitlist migration..."
wrangler d1 execute bucksy-db --file=./migrations/0006_waitlist.sql

# Apply verification migration
echo "Applying verification migration..."
wrangler d1 execute bucksy-db --file=./migrations/0007_waitlist_verification_sent_at.sql

# Apply email logs migration
echo "Applying email logs migration..."
wrangler d1 execute bucksy-db --file=./migrations/0008_email_logs.sql

# Apply admin tables migration
echo "Applying admin tables migration..."
wrangler d1 execute bucksy-db --file=./migrations/0009_admin_tables.sql

echo "✅ All migrations applied!"

# Set environment variables
echo "🔑 Setting up environment variables..."

# Generate a secure admin token
ADMIN_TOKEN=$(openssl rand -base64 32)
echo "Generated admin token: $ADMIN_TOKEN"

# Update pages.toml with environment variables
cat > pages.toml << EOF
# Cloudflare Pages configuration for Bucksy project

[build]
command = "npm run build"  # Or your build command if you have one

[build.environment]
NODE_VERSION = "18"

# Environment variables
[env.production]
vars = { 
  ADMIN_TOKEN = "$ADMIN_TOKEN",
  WAITLIST_EMAIL_PROVIDER = "resend",
  RESEND_API_KEY = "your_resend_api_key_here",
  WAITLIST_FROM_EMAIL = "noreply@bucksy.life"
}
EOF

echo "✅ Updated pages.toml with environment variables"

# Add sample data (optional)
echo "📝 Adding sample data..."
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-1', 'user1@example.com', 'Alice Johnson', 'verified', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-2', 'user2@example.com', 'Bob Smith', 'pending', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO waitlist (id, email, name, status, created_at, updated_at) VALUES ('sample-user-3', 'user3@example.com', 'Carol Davis', 'verified', 1698765432100, 1698765432100);"
wrangler d1 execute bucksy-db --command="INSERT INTO admin_actions (id, admin_id, admin_email, action, data, created_at) VALUES ('sample-action-1', 'admin', 'admin@bucksy.life', 'Test dashboard access', '{}', 1698765432100);"

echo "✅ Sample data added!"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update your email provider API key in pages.toml"
echo "2. Deploy your Pages project:"
echo "   wrangler pages deploy"
echo "3. Access the admin dashboard:"
echo "   https://your-domain.com/admin/login"
echo ""
echo "Admin token: $ADMIN_TOKEN"
echo ""
echo "💡 Tip: Save this admin token somewhere safe!"