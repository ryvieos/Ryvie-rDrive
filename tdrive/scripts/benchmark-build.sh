#!/bin/bash
# Script pour mesurer le temps de build du frontend

set -e

echo "🔍 Benchmark du build frontend Docker"
echo "======================================"
echo ""

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Fonction pour mesurer le temps
measure_build() {
    local description=$1
    local build_args=$2
    
    echo -e "${YELLOW}📊 Test: ${description}${NC}"
    
    # Nettoyer les images existantes
    docker rmi -f tdrive-frontend-test 2>/dev/null || true
    
    # Mesurer le temps
    start_time=$(date +%s)
    
    if eval "docker build ${build_args} -t tdrive-frontend-test -f docker/tdrive-frontend/Dockerfile . 2>&1 | tee /tmp/build.log"; then
        end_time=$(date +%s)
        duration=$((end_time - start_time))
        
        echo -e "${GREEN}✅ Build réussi en ${duration}s${NC}"
        
        # Analyser les étapes les plus lentes
        echo "   Étapes les plus lentes:"
        grep -E "^\[frontend build [0-9]+/[0-9]+\]" /tmp/build.log | tail -5
        
        return 0
    else
        end_time=$(date +%s)
        duration=$((end_time - start_time))
        echo -e "${RED}❌ Build échoué après ${duration}s${NC}"
        return 1
    fi
    
    echo ""
}

# Test 1: Build sans cache
echo "Test 1/4: Build complet sans cache"
measure_build "Build sans cache (baseline)" "--no-cache"

# Test 2: Rebuild sans changement
echo "Test 2/4: Rebuild sans changement (test du cache)"
measure_build "Rebuild avec cache complet" ""

# Test 3: Rebuild avec changement mineur
echo "Test 3/4: Rebuild avec changement mineur"
touch tdrive/frontend/src/app/test-$(date +%s).txt
measure_build "Rebuild avec fichier modifié" ""
rm -f tdrive/frontend/src/app/test-*.txt

# Test 4: Build avec BuildKit
echo "Test 4/4: Build avec BuildKit activé"
export DOCKER_BUILDKIT=1
measure_build "Build avec BuildKit" "--progress=plain"

echo ""
echo "======================================"
echo -e "${GREEN}✅ Benchmark terminé${NC}"
echo ""
echo "💡 Conseils:"
echo "   - Le Test 1 est votre baseline (temps incompressible)"
echo "   - Le Test 2 devrait être 3-5x plus rapide avec le cache"
echo "   - Le Test 4 avec BuildKit devrait être le plus rapide"
echo ""
echo "📝 Logs détaillés disponibles dans: /tmp/build.log"
