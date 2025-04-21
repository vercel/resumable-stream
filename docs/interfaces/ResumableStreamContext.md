[**Resumable Stream v1.0.3**](../README.md)

***

[Resumable Stream](../README.md) / ResumableStreamContext

# Interface: ResumableStreamContext

## Properties

### resumableStream()

> **resumableStream**: (`streamId`, `makeStream`, `resumeAt?`) => `Promise`\<`ReadableStream`\<`string`\>\>

Creates a resumable stream.

Throws if the underlying stream is already done. Instead save the complete output to a database and read from that
after streaming completed.

By default returns the entire buffered stream. Use `resumeAt` to resume from a specific point.

#### Parameters

##### streamId

`string`

The ID of the stream. Must be unique for each stream.

##### makeStream

() => `ReadableStream`\<`string`\>

A function that returns a stream of lines. It's only executed if the stream it not yet in progress.

##### resumeAt?

`number`

The number of lines to skip.

#### Returns

`Promise`\<`ReadableStream`\<`string`\>\>

A readable stream of strings.
