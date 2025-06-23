[**Resumable Stream v2.2.0**](../README.md)

***

[Resumable Stream](../README.md) / CreateResumableStreamContextOptions

# Interface: CreateResumableStreamContextOptions

## Properties

### keyPrefix?

> `optional` **keyPrefix**: `string`

The prefix for the keys used by the resumable streams. Defaults to `resumable-stream`.

***

### publisher?

> `optional` **publisher**: `Redis` \| [`Publisher`](Publisher.md)

A pubsub publisher. Designed to be compatible with clients from the `redis` package.

***

### subscriber?

> `optional` **subscriber**: [`Subscriber`](Subscriber.md) \| `Redis`

A pubsub subscriber. Designed to be compatible with clients from the `redis` package.

***

### waitUntil()

> **waitUntil**: (`promise`) => `void`

A function that takes a promise and ensures that the current program stays alive until the promise is resolved.

#### Parameters

##### promise

`Promise`\<`unknown`\>

#### Returns

`void`
