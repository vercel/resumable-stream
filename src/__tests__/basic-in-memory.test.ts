import { createInMemoryPubSubForTesting } from "../../testing-utils/in-memory-pubsub";
import { resumableStreamTests } from "./tests";

resumableStreamTests(createInMemoryPubSubForTesting, "redis");
