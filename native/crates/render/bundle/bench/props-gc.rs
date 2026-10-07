use deno_core::{op2, v8};
fn heap_stats(scope: &mut v8::PinScope) -> (usize, usize) {
    let old = (0..scope.number_of_heap_spaces())
        .filter_map(|i| scope.get_heap_space_statistics(i))
        .filter(|s| !s.space_name().to_bytes().starts_with(b"new_"))
        .map(|s| s.space_used_size())
        .sum();
    (old, scope.get_heap_statistics().used_heap_size())
}
#[op2]
#[serde]
fn op_props_gc(scope: &mut v8::PinScope, full: bool) -> (usize, usize, usize, usize) {
    let before = heap_stats(scope);
    scope.request_garbage_collection_for_testing(if full {
        v8::GarbageCollectionType::Full
    } else {
        v8::GarbageCollectionType::Minor
    });
    let after = heap_stats(scope);
    (before.0, before.1, after.0, after.1)
}
deno_core::extension!(props_gc_ops, ops = [op_props_gc]);
