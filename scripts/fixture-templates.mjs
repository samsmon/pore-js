import { strToU8 } from 'fflate';

export const PALETTES = [
  ['#1e293b', '#38bdf8'],
  ['#3b0764', '#e879f9'],
  ['#052e16', '#4ade80'],
  ['#450a0a', '#fb7185'],
  ['#422006', '#fbbf24'],
  ['#0c4a6e', '#7dd3fc'],
];

export function pageSvg({ w, h, label, sub, n }) {
  const [bg, fg] = PALETTES[n % PALETTES.length];
  const panels = [];
  const rows = h > w * 1.6 ? 4 : 2;
  const cols = w > h ? 3 : 2;
  const gap = 24;
  const pw = (w - gap * (cols + 1)) / cols;
  const ph = (h - gap * (rows + 1) - 120) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gap + c * (pw + gap);
      const y = 100 + gap + r * (ph + gap);
      panels.push(
        `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="10" fill="${fg}" opacity="0.14" stroke="${fg}" stroke-opacity="0.5"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  ${panels.join('\n  ')}
  <text x="${w / 2}" y="64" fill="${fg}" font-family="system-ui, sans-serif" font-size="40" font-weight="700" text-anchor="middle">${label}</text>
  <text x="${w / 2}" y="${h - 32}" fill="${fg}" font-family="system-ui, sans-serif" font-size="22" text-anchor="middle" opacity="0.8">${sub}</text>
</svg>
`;
}

export const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. ';

export const JP =
  'これは縦書きのテストです。ポア・ジェイエスの読書エンジンは、日本語の縦組みに対応しています。' +
  '文字は上から下へ流れ、行は右から左へと進みます。ページをめくると、次の行が左側から現れます。' +
  '矢印キーの左で次のページ、右で前のページに移動します。ホイールやクリックでも操作できます。' +
  '組版の設定は「縦書き」を自動・オン・オフから選べます。既定では言語が日本語で右綴じの場合に有効になります。';

export const AR =
  'هذا كتاب تجريبي لاختبار القراءة من اليمين إلى اليسار في بور جي إس. ' +
  'الأعمدة هنا تمتلئ من اليمين إلى اليسار كما هو معتاد في القراءة العربية، ' +
  'وزر السهم الأيسر يعني الصفحة التالية بينما يعني السهم الأيمن الصفحة السابقة. ' +
  'هذا النص وُلِّد آليًا فقط لاختبار عرض النص واتجاهه، وليس عملاً أدبيًا حقيقيًا.';

const CONTAINER_XML = `<?xml version="1.0"?>\n<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function chapterXhtml(n, title) {
  const paras = Array.from(
    { length: 6 + ((n * 3) % 5) },
    (_, i) => `<p>${LOREM.repeat(2 + (i % 3))}</p>`,
  ).join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${title}</title><link rel="stylesheet" href="style.css"/></head>
  <body>
    <h1 id="top">${title}</h1>
    ${paras}
    <p><a epub:type="noteref" href="notes.xhtml#n${n}">[${n}]</a> a footnote marker.</p>
  </body>
</html>`;
}

export function buildDemoBookFiles() {
  const chapters = [
    { id: 'c1', file: 'ch1.xhtml', title: 'The Beginning' },
    { id: 'c2', file: 'ch2.xhtml', title: 'A Complication' },
    { id: 'c3', file: 'ch3.xhtml', title: 'The Resolution' },
  ];
  const manifestItems = chapters
    .map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`)
    .join('\n    ');
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ');
  const navList = chapters
    .map((c) => `<li><a href="${c.file}">${c.title}</a></li>`)
    .join('\n        ');

  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">pore-demo-book</dc:identifier>
    <dc:title>The Pore.js Demo Book</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Synthetic Author</dc:creator>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`,
    ),
    'OEBPS/nav.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body><nav epub:type="toc"><h1>Contents</h1><ol>
        ${navList}
      </ol></nav></body>
</html>`,
    ),
    'OEBPS/notes.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Notes</title></head><body>
  <p id="n1">First note. ${LOREM}</p>
  <p id="n2">Second note. ${LOREM}</p>
  <p id="n3">Third note. ${LOREM}</p>
</body></html>`,
    ),
    'OEBPS/style.css': strToU8(
      `h1 { font-weight: 700; margin: 1.5em 0 0.5em; }\np { margin: 0 0 1em; text-indent: 1.5em; }\np:first-of-type { text-indent: 0; }`,
    ),
  };
  for (const c of chapters) {
    files[`OEBPS/${c.file}`] = strToU8(chapterXhtml(Number(c.id.slice(1)), c.title));
  }
  return files;
}

export function buildLocalizedEpubFiles({
  id,
  title,
  lang,
  dirAttr,
  creator,
  navTitle,
  css,
  text,
  chapters,
}) {
  const renderChapter = (chTitle, n) => {
    const paras = Array.from(
      { length: 5 + n },
      (_, i) => `<p>${text.repeat(2 + (i % 3))}</p>`,
    ).join('\n    ');
    const dir = dirAttr ? ` dir="${dirAttr}"` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}"${dir}>
  <head><title>${chTitle}</title><link rel="stylesheet" href="style.css"/></head>
  <body><h1>${chTitle}</h1>\n    ${paras}\n  </body>
</html>`;
  };
  const manifestItems = chapters
    .map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`)
    .join('\n    ');
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ');
  const navList = chapters
    .map((c) => `<li><a href="${c.file}">${c.title}</a></li>`)
    .join('\n        ');
  const dir = dirAttr ? ` dir="${dirAttr}"` : '';
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${lang}</dc:language>
    <dc:creator>${creator}</dc:creator>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine page-progression-direction="rtl">
    ${spine}
  </spine>
</package>`,
    ),
    'OEBPS/nav.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}"${dir}>
  <head><title>${navTitle}</title></head>
  <body><nav epub:type="toc"><h1>${navTitle}</h1><ol>\n        ${navList}\n      </ol></nav></body>
</html>`,
    ),
    'OEBPS/style.css': strToU8(css),
  };
  for (const c of chapters) {
    files[`OEBPS/${c.file}`] = strToU8(renderChapter(c.title, Number(c.id.slice(1))));
  }
  return files;
}

export function buildFixedBookFiles() {
  const W = 750;
  const H = 1000;
  const PAGES = [
    { id: 'p1', title: 'A Good Morning', bg: '#fef3c7', fg: '#92400e' },
    { id: 'p2', title: 'The Long Walk', bg: '#dbeafe', fg: '#1e3a8a' },
    { id: 'p3', title: 'A Quiet Rest', bg: '#ede9fe', fg: '#5b21b6' },
    { id: 'p4', title: 'Home Again', bg: '#dcfce7', fg: '#14532d' },
  ];
  const pageXhtml = (p, n) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${p.title}</title>
  <meta name="viewport" content="width=${W}, height=${H}"/>
  <style>
    html, body { margin: 0; width: ${W}px; height: ${H}px; background: ${p.bg}; overflow: hidden; }
    .panel { position: absolute; inset: 48px; border: 8px solid ${p.fg}; border-radius: 28px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .sun { position: absolute; top: 90px; left: 50%; transform: translateX(-50%); width: 160px; height: 160px; border-radius: 50%; background: ${p.fg}; opacity: 0.25; }
    .num { position: absolute; top: 24px; right: 32px; font: 700 28px sans-serif; color: ${p.fg}; }
    h1 { font: 700 46px Georgia, serif; color: ${p.fg}; text-align: center; padding: 0 56px; margin: 0; }
  </style>
</head>
<body>
  <div class="sun"></div>
  <div class="num">${n} / ${PAGES.length}</div>
  <div class="panel"><h1>${p.title}</h1></div>
</body>
</html>`;

  const manifestItems = PAGES.map(
    (p) => `<item id="${p.id}" href="${p.id}.xhtml" media-type="application/xhtml+xml"/>`,
  ).join('\n    ');
  const spine = PAGES.map((p) => `<itemref idref="${p.id}"/>`).join('\n    ');
  const navList = PAGES.map((p) => `<li><a href="${p.id}.xhtml">${p.title}</a></li>`).join(
    '\n        ',
  );

  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">pore-demo-fixed</dc:identifier>
    <dc:title>A Good Morning — Fixed-Layout Demo</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Synthetic Author</dc:creator>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`,
    ),
    'OEBPS/nav.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body><nav epub:type="toc"><h1>Contents</h1><ol>
        ${navList}
      </ol></nav></body>
</html>`,
    ),
  };
  PAGES.forEach((p, i) => {
    files[`OEBPS/${p.id}.xhtml`] = strToU8(pageXhtml(p, i + 1));
  });
  return files;
}
