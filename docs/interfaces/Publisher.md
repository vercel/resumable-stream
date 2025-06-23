[**Resumable Stream v2.2.0**](../README.md)

***

[Resumable Stream](../README.md) / Publisher

# Interface: Publisher

A Redis-like publisher. Designed to be compatible with clients from both the `redis` and `ioredis` packages.

## Properties

### connect()

> **connect**: () => `Promise`\<`unknown`\>

#### Returns

`Promise`\<`unknown`\>

***

### get()

> **get**: (`key`) => `Promise`\<`null` \| `string` \| `number`\>

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`null` \| `string` \| `number`\>

***

### incr()

> **incr**: (`key`) => `Promise`\<`number`\>

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`number`\>

***

### publish()

> **publish**: (`channel`, `message`) => `Promise`\<`unknown`\>

#### Parameters

##### channel

`string`

##### message

`string`

#### Returns

`Promise`\<`unknown`\>

***

### set()

> **set**: (`key`, `value`, `options?`) => `Promise`\<`unknown`\>

#### Parameters

##### key

`string`

##### value

`string`

##### options?

###### EX?

`number`

#### Returns

`Promise`\<`unknown`\>
