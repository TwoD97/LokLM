#![cfg(target_os = "linux")]

use glib::variant::ToVariant;

// Run with --release: the original shared out-pointer was undefined behavior
// and optimized builds could treat it as unchanged, then dereference null.
#[test]
fn borrowed_string_iterator_exercises_every_out_pointer_entrypoint() {
    let variant = vec!["alpha", "München", "東京", ""].to_variant();
    assert_eq!(variant.array_iter_str().unwrap().next(), Some("alpha"));
    assert_eq!(variant.array_iter_str().unwrap().nth(1), Some("München"));
    assert_eq!(variant.array_iter_str().unwrap().last(), Some(""));
    assert_eq!(variant.array_iter_str().unwrap().next_back(), Some(""));
    assert_eq!(variant.array_iter_str().unwrap().nth_back(1), Some("東京"));
}

#[test]
fn borrowed_string_iterator_preserves_double_ended_progress() {
    let variant = vec!["first", "middle", "last"].to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.size_hint(), (3, Some(3)));
    assert_eq!(iter.next_back(), Some("last"));
    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.len(), 1);
    assert_eq!(iter.next_back(), Some("middle"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn empty_and_exhausted_string_iterators_do_not_read_outside_the_variant() {
    let variant = Vec::<String>::new().to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.nth(usize::MAX), None);
    assert_eq!(iter.nth_back(usize::MAX), None);
}
