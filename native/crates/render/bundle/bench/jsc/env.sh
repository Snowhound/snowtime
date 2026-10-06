# Paths shared by the jsc scripts. Override RENDER_RESULTS when the captures live in
# another checkout, JSC_OUT for raw output, and JSC_ROOT for the downloaded WebKit.
H=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
B=$(cd "$H/../.." && pwd)
REPO=$(cd "$B/../../../.." && pwd)
RESULTS=${RENDER_RESULTS:-$REPO/native/crates/render/results}
OUT=${JSC_OUT:-$REPO/native/crates/render/results/engine-gap/jsc}
JSC_ROOT=${JSC_ROOT:-/root/jsc}
# The JSC options Bun 1.4.2 sets that differ from the jsc shell's defaults
# (src/jsc/bindings/ZigGlobalObject.cpp)
BUNOPTS="--heapGrowthSteepnessFactor=1 --heapGrowthMaxIncrease=2 --largeHeapSize=8388608 --useV8DateParser=1 --useShadowRealm=1"
mkdir -p "$OUT"
