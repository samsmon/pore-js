// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { loadPdf } from './pdf/parse.js';
import { LocalFileSource } from './source/local-file-source.js';
import { parseEpub } from './text/epub/parse.js';

/**
 * H4 — a corrupt / hostile input must fail *cleanly*: a real `Error` (or a
 * graceful fallback), never a raw `TypeError`/`undefined` crash, an infinite
 * hang, or a silent blank. Full "the demo shows an error card" coverage is in
 * the e2e suites; this pins the parse/source layer.
 */

const container = (fullPath = 'OEBPS/content.opf') => `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="${fullPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest><item id="c1" href="ch01.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe('parseEpub — malformed archives', () => {
  const cases: Array<[string, Uint8Array]> = [
    ['empty buffer', new Uint8Array()],
    ['not a zip', strToU8('this is plainly not a zip file at all')],
    ['truncated zip', zip({ mimetype: 'application/epub+zip' }).slice(0, 12)],
    ['zip without container.xml', zip({ 'OEBPS/content.opf': OPF })],
    [
      'container.xml is not XML',
      zip({ 'META-INF/container.xml': 'nope', 'OEBPS/content.opf': OPF }),
    ],
    [
      'container names a missing OPF',
      zip({ 'META-INF/container.xml': container('OEBPS/nope.opf') }),
    ],
    [
      'OPF is malformed XML',
      zip({ 'META-INF/container.xml': container(), 'OEBPS/content.opf': '<package' }),
    ],
    [
      'OPF has no spine',
      zip({
        'META-INF/container.xml': container(),
        'OEBPS/content.opf':
          '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><manifest/></package>',
      }),
    ],
  ];

  for (const [name, bytes] of cases) {
    it(`${name} → throws a real Error, no raw crash`, () => {
      let thrown: unknown;
      try {
        const book = parseEpub(bytes);
        // if it didn't throw, it must still be a coherent object
        expect(Array.isArray(book.spine)).toBe(true);
        return;
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/epub|xml|zip|opf|spine|container/i);
    });
  }
});

describe('LocalFileSource — hostile files', () => {
  const mk = (name: string, bytes: BlobPart) => new LocalFileSource([new File([bytes], name)]);

  it('a 0-byte .epub → getManifest is lazy, but parsing the file fails cleanly', async () => {
    const src = mk('book.epub', new Uint8Array());
    // getManifest may be lazy (metadata only) — that's fine…
    await src.getManifest('x');
    // …but the real bytes must fail with a real Error, not a raw crash
    const bytes = new Uint8Array(await (await src.getFile('x')).arrayBuffer());
    expect(() => parseEpub(bytes)).toThrow(Error);
  });

  it('a .cbz that is not a zip → getManifest rejects, does not hang', async () => {
    await expect(mk('book.cbz', 'garbage').getManifest('x')).rejects.toBeInstanceOf(Error);
  });

  it('an unknown extension → still resolves to *some* manifest or a clean error', async () => {
    const src = mk('mystery.bin', new Uint8Array([1, 2, 3]));
    await src.getManifest('x').then(
      (m) => expect(m).toHaveProperty('type'),
      (e) => expect(e).toBeInstanceOf(Error),
    );
  });

  it('getPage out of range → RangeError, not undefined', async () => {
    const src = mk('a.cbz', zip({ '1.png': 'x', '2.png': 'y' }) as unknown as BlobPart);
    await src.getManifest('x').catch(() => {});
    await expect(src.getPage('x', 999)).rejects.toBeInstanceOf(Error);
  });
});

describe('loadPdf — malformed PDFs', () => {
  for (const [name, bytes] of [
    ['empty', new Uint8Array()],
    ['not a pdf', strToU8('%definitely not%')],
    ['truncated header', strToU8('%PDF-1.4\n%%EO')],
  ] as Array<[string, Uint8Array]>) {
    it(`${name} → rejects with an Error, no hang`, async () => {
      await expect(loadPdf(bytes)).rejects.toBeInstanceOf(Error);
    });
  }
});
