# Qerlan slot reservation function

The following TypeScript function is the complete slot reservation rule used by the fictional Qerlan scheduler. Inputs and return values are integer slot counts.

```typescript
export function reserveSlots(capacity: number, occupied: number): number {
  const remaining = Math.max(0, capacity - occupied)
  return Math.min(4, remaining)
}
```

The limit is four slots per reservation. A negative remaining capacity does not produce a negative reservation.
