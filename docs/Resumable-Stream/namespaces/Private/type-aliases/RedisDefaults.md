[**Resumable Stream v2.2.8**](../../../../README.md)

***

[Resumable Stream](../../../../README.md) / [\_Private](../README.md) / RedisDefaults

# Type Alias: RedisDefaults

> **RedisDefaults** = `object`

## Properties

### publisher()

> **publisher**: () => [`Publisher`](../../../../interfaces/Publisher.md)

A pubsub publisher. Designed to be compatible with clients from the `redis` package.

#### Returns

[`Publisher`](../../../../interfaces/Publisher.md)

***

### subscriber()

> **subscriber**: () => [`Subscriber`](../../../../interfaces/Subscriber.md)

A pubsub subscriber. Designed to be compatible with clients from the `redis` package.

#### Returns

[`Subscriber`](../../../../interfaces/Subscriber.md)
