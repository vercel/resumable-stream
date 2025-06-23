[**Resumable Stream v2.2.0**](../README.md)

***

[Resumable Stream](../README.md) / Subscriber

# Interface: Subscriber

A Redis-like subscriber. Designed to be compatible with clients from both the `redis` and `ioredis` packages.

## Properties

### connect()

> **connect**: () => `Promise`\<`unknown`\>

#### Returns

`Promise`\<`unknown`\>

***

### subscribe()

> **subscribe**: (`channel`, `callback`) => `Promise`\<`number` \| `void`\>

#### Parameters

##### channel

`string`

##### callback

(`message`) => `void`

#### Returns

`Promise`\<`number` \| `void`\>

***

### unsubscribe()

> **unsubscribe**: (`channel`) => `Promise`\<`unknown`\>

#### Parameters

##### channel

`string`

#### Returns

`Promise`\<`unknown`\>
