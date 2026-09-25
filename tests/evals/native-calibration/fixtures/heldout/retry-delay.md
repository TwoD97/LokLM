# Fenrik retry scheduling function

The following TypeScript function is the complete retry rule used by the fictional Fenrik scheduler. The attempt is an integer, baseSeconds is positive, and the returned delay is measured in seconds.

```typescript
export function retryDelaySeconds(attempt: number, baseSeconds: number): number {
  if (attempt <= 0) return 0
  return Math.min(attempt * baseSeconds, 90)
}
```

The maximum delay is 90 seconds. Attempts numbered zero or lower do not wait.
