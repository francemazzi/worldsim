# Phones & Movement

Agents that own the right assets can text each other, place phone calls (their dialog is transcribed as a chat), and move around the world under rules you control.

```typescript
import {
  WorldEngine,
  InMemoryAssetStore,
  PhonePlugin,
  MovementPlugin,
  LocationIndex,
  createPhoneAsset,
  defaultMovementPolicy,
} from "worldsim";

const assetStore = new InMemoryAssetStore();
const locationIndex = new LocationIndex();

const engine = new WorldEngine({
  /* ...llm, stores... */
  assetStore,
  // Default policy allows walking within 1.5 km, requires a vehicle beyond.
  walkingRadiusMeters: 1500,
  // Or replace with your own rules (health data, public transit, licenses, …):
  // movementPolicy: (req) => ({ allowed: req.distanceMeters < 500, mode: "walking" }),
});

engine.use(new MovementPlugin(locationIndex));
engine.use(
  new PhonePlugin({
    assetStore,
    messageBus: engine.getMessageBus(),
    conversationManager: engine.getConversationManager(),
  }),
);

// Give Alice a phone and a car so she can text, call, and drive long distances.
await assetStore.addAssets([
  createPhoneAsset({ agentId: "alice", phoneNumber: "+39 111" }),
  { id: "car-alice", type: "vehicle", name: "Panda", owner: "alice", ownerType: "agent" },
]);
```

## Phone tools

Once their phone is registered, agents automatically get four tools: `send_sms`, `start_call`, `speak_in_call`, `hang_up`. Call transcripts land on the bus as regular `Message`s with `type: "call_transcript"` and `metadata.callId`, so UIs and the reporting plugin can render them as chat turns.

## Movement policy

Movement is governed by a `MovementPolicy` — a pure function that receives `{ agentId, from, to, distanceMeters, assets, profile }` and returns `{ allowed, mode?, reason? }`. Swap `defaultMovementPolicy` for anything you need: public transit, HealthKit steps, weather, curfews. WorldSim stays agnostic.

## Related guides

- [Perception Layer](/perception) — combine movement with proximity-based hearing and sight
- [Creating Scenarios](/guide/creating-scenarios) — wire phones and movement into a full scenario
