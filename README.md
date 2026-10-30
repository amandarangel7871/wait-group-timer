# wait-group-timer

Tracks multiple concurrent operation timeouts against an injected clock and reports which operations completed before their deadline versus which exceeded it.

```js
import { WaitGroupTimer } from 'wait-group-timer';

const clock = { now: () => Date.now() };
const wg = new WaitGroupTimer({ now: clock.now });

const t1 = wg.add('fetch-users', 500);
const t2 = wg.add('fetch-orders', 500);

// when each operation finishes, record it
wg.done(t1);
// ... later
const { completed, expired, pending } = wg.summary();
console.log(completed, expired, pending);
```

## Why this exists

Coordinating several concurrent operations and answering "did each one beat its deadline?" is easy to get wrong if you build it inline with timers and counters. The subtle part is that "expired" is a fact derived from the clock at query time, not an event you necessarily observe the moment it happens. This library records each operation's add-time, deadline, and (if it occurs) completion-time, and derives the partition on demand.

The trade-off: `add()` returns an integer token rather than keying on the name you gave. Duplicate names are allowed and tracked independently, so you must keep the token to call `done()`. We picked this over rejecting duplicates because rejecting would force callers to manufacture unique names, which defeats the point of a wait group.

## The awkward edge

`done()` after the deadline still marks the operation `completed`, not `expired`. The library reports facts ("it finished at time T"), and an operation can finish late. If you want strict deadline enforcement, treat any `completed` record whose `completedAt > deadline` as a failure in your own code — the data is there in the status object.

At the exact deadline (`now === deadline`) the operation is considered `expired`, not `pending`.

## Tests

```
node --test
```

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

