# Notices

## Code adapted from God's Eye View

Parts of this project were adapted from **God's Eye View**
(<https://github.com/bilawalsidhu/gods-eye-view>), commit
`880a672b5e16ad3e41d318801d3a5203f9201923`. Which files, and whether each is
verbatim or modified, is recorded in `provenance/PORT-MANIFEST.json` and checked by
`pnpm check:provenance`. The original licence applies to those files:

```
MIT License

Copyright (c) 2026 Bilawal Sidhu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

What was reused: the idle render governor, the retryable one-shot loader, the
Natural Earth region lookup and its data pack, and the map-stack controller (adapted).
The viewer bootstrap and the "honest feed state" vocabulary were re-implemented from
the same ideas. Everything else in this repository is new.

Deliberately **not** carried over: aircraft/ship/CCTV/radio/military layers, the cockpit
UI, the OpenAI Realtime voice stack, all QA/puppeteer scripts, and every bundled dataset
or 3D model whose licence forbids commercial use (see DATA_SOURCES.md).

## Libraries

Runtime and build libraries are listed with their exact versions in `pnpm-lock.yaml`;
`docs/SUPPLY-CHAIN.md` explains how they were vetted. CesiumJS is Apache-2.0.
