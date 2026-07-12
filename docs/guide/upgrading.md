# Upgrading from Older Versions

Legacy simulations remain the default: omitting `interaction` or setting `interaction.mode: "legacy"` keeps the original message routing behavior. The perception layer is opt-in with `interaction.mode: "perception"`.

## Supported public imports

```typescript
import { WorldEngine } from "worldsim";
import { format as formatFederatedAgentId } from "worldsim/federation";
```

CommonJS remains supported:

```javascript
const { WorldEngine } = require("worldsim");
```

Deep imports such as `worldsim/dist/...` or `worldsim/src/...` are not part of the public API and may change between releases.

## Migration checklist

1. **Message routing** — If you relied on global broadcast, keep `interaction.mode: "legacy"` (default). Switch to `"perception"` only when you want sensory limits.
2. **Perception mode** — Set `interaction.defaultSenses` and optionally `disableBroadcastFallback: true` for strict physics-aware worlds. See [Perception Layer](/perception).
3. **Groups & gatherings** — From `1.3.x`, wire `groupStore` and `gatheringStore` on `WorldConfig` if you need structured multi-agent events. See [Groups & Gatherings](/guide/groups-and-gatherings).
4. **Federation** — Cross-world messaging is opt-in via `WorldConfig.federation`. See [Federation](/federation).
5. **Closed routing** — Replace patches to internal `MessageRouter` methods with
   `messageRouting.unroutablePolicy: "drop"` or `"error"`. Observe exact
   delivery outcomes through the public `onMessageRouted` plugin hook.
