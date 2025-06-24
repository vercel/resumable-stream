[**Resumable Stream v2.2.0**](../README.md)

***

[Resumable Stream](../README.md) / createResumableStreamContext

# Variable: createResumableStreamContext()

> `const` **createResumableStreamContext**: (`options`) => [`ResumableStreamContext`](../interfaces/ResumableStreamContext.md)

Creates a global context for resumable streams from which you can create resumable streams.

Call `resumableStream` on the returned context object to create a stream.

## Parameters

### options

[`CreateResumableStreamContextOptions`](../interfaces/CreateResumableStreamContextOptions.md)

The context options.

## Returns

[`ResumableStreamContext`](../interfaces/ResumableStreamContext.md)

A resumable stream context.
