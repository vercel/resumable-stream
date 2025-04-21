[**Resumable Stream v2.0.0**](../README.md)

***

[Resumable Stream](../README.md) / ResumableStreamContext

# Interface: ResumableStreamContext

## Properties

### resumableStream()

> **resumableStream**: (`streamId`, `makeStream`, `skipCharacters?`) => `Promise`\<`null` \| `ReadableStream`\<`string`\>\>

Creates a resumable stream.

Throws if the underlying stream is already done. Instead save the complete output to a database and read from that
after streaming completed.

By default returns the entire buffered stream. Use `skipCharacters` to resume from a specific point.

#### Parameters

##### streamId

`string`

The ID of the stream. Must be unique for each stream.

##### makeStream

() => `ReadableStream`\<`string`\>

A function that returns a stream of strings. It's only executed if the stream it not yet in progress.

##### skipCharacters?

`number`

Number of characters to skip

#### Returns

`Promise`\<`null` \| `ReadableStream`\<`string`\>\>

A readable stream of strings. Returns null if there was a stream with the given streamId but it is already fully done (Defaults to 24 hour expiration)
