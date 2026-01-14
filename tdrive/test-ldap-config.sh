#!/bin/bash

echo "🔍 Testing LDAP Configuration"
echo "=============================="
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Source the .env file
source .env

echo "📋 Environment Variables:"
echo "   LDAP_BIND_PASSWORD: ${LDAP_BIND_PASSWORD:-NOT SET}"
echo ""

# Check if LDAP_BIND_PASSWORD is set
if [ -z "$LDAP_BIND_PASSWORD" ]; then
    echo "❌ LDAP_BIND_PASSWORD is not set in .env file"
    exit 1
fi

if [ "$LDAP_BIND_PASSWORD" = "adminpassword" ]; then
    echo "⚠️  WARNING: LDAP_BIND_PASSWORD is using default value 'adminpassword'"
    echo "   This may not be correct for your LDAP server"
fi

echo "✅ LDAP_BIND_PASSWORD is set to: ${LDAP_BIND_PASSWORD}"
echo ""

echo "🔄 Next steps:"
echo "   1. Rebuild the node container: docker-compose build node"
echo "   2. Restart containers: docker-compose up -d"
echo "   3. Check logs: docker-compose logs -f node_create_user"
echo ""
