[**Resumable Stream v2.0.0**](../README.md)

***

[Resumable Stream](../README.md) / Subscriber

# Interface: Subscriber

A Redis-like subscriber. Designed to be compatible with clients from the `redis` package.

## Properties

### connect()

> **connect**: () => `Promise`\<`unknown`\>

#### Returns

`Promise`\<`unknown`\>

***

### subscribe()

> **subscribe**: (`channel`, `callback`) => `Promise`\<`void`\>

#### Parameters

##### channel

`string`

##### callback

(`message`) => `void`

#### Returns

`Promise`\<`void`\>

***

### unsubscribe()

> **unsubscribe**: (`channel`) => `Promise`\<`unknown`\>

#### Parameters

##### channel

`string`

#### Returns

`Promise`\<`unknown`\>
