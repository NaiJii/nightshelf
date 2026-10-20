import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "./parser" && context.parentURL?.endsWith("/webtoon.ts")) return next(new URL("../src/lib/parser.ts", import.meta.url).href, context);
  return next(specifier, context);
} });
try {
  const { parseWebtoonCards, parseWebtoonDetails, parseWebtoonEpisodes, parseWebtoonImages, webtoonLanguage, webtoonUrl, webtoonSearchHasNext, WEBTOON_LANGUAGES } = await import("../src/lib/webtoon.ts");
  const { filterDiscovery } = await import("../src/lib/parser.ts");
  const url = "https://www.webtoons.com/en/fantasy/example/list?title_no=42";
  const card = `<a href="${url}"><img src="https://webtoon-phinf.pstatic.net/cover.jpg"><strong class="title">A &amp; B</strong></a>`;
  const series = parseWebtoonCards(card + card, "en")[0];
  assert.equal(series.title, "A & B");
  assert.equal(series.slug, "webtoon-en-42");
  assert.equal(parseWebtoonCards(card + card, "en").length, 1);
  assert.equal(parseWebtoonCards(card, "fr").length, 0);
  assert.equal(webtoonUrl("https://www.webtoons.com.evil.test/en/x/list?title_no=42"), null);
  assert.equal(webtoonUrl("http://www.webtoons.com/en/x/list?title_no=42"), null);
  assert.equal(webtoonLanguage("../../evil"), "en");
  const ep = (id, name, extra = "") => `<li ${extra}><a href="https://www.webtoons.com/en/fantasy/example/${id}/viewer?title_no=42&amp;episode_no=${id}"><span class="subj"><span>${name}</span></span><span class="date">Oct 14, 2026</span></a></li>`;
  const episodes = parseWebtoonEpisodes(`<ul id="_listUl">${ep("10", "Episode Nine")}${ep("2", "Episode One")}${ep("11", "Locked", 'data-locked="true"')}</ul><a href="/en/fantasy/example/list?title_no=42&amp;page=2" class=pg_page>2</a>`, url);
  assert.deepEqual(episodes.ids, ["2", "10"]);
  assert.equal(episodes.titles["10"], "Episode Nine");
  assert.equal(episodes.next, url + "&page=2");
  assert.ok(episodes.updatedAt);
  const html = `<meta property="og:url" content="${url}"><meta property="og:title" content="A &amp; B"><p class="summary">The full summary.</p><p class="day_info">COMPLETED</p>`;
  const details = parseWebtoonDetails(html, series);
  assert.equal(details.status, "Completed");
  assert.equal(details.summary, "The full summary.");
  const firstLoad = parseWebtoonDetails(html + `<ul id="_listUl">${ep("10", "Latest episode")}</ul>`, series);
  assert.equal(firstLoad.chapterCount, 10, 'first-load metadata reads episode links without requiring data-episode-no');
  assert.equal(firstLoad.latestChapter, '10');
  assert.ok(firstLoad.updatedAt && firstLoad.sourceDates, 'publication status is available before a full chapter refresh');
  assert.equal(firstLoad.chapterIds, undefined, 'metadata reads only the current page and does not cache an incomplete chapter list');
  assert.throws(() => parseWebtoonDetails(html, { ...series, language: "fr" }), /unavailable/);
  const panels = `<img class="_images" src="https://webtoons-static.pstatic.net/placeholder.png" data-url="https://webtoon-phinf.pstatic.net/panel.jpg?type=q90"><img class="_thumbnailImages" data-url="https://webtoon-phinf.pstatic.net/thumb.jpg"><img class="_images" data-url="https://evil.test/panel.jpg">`;
  assert.deepEqual(parseWebtoonImages(panels), ["https://webtoon-phinf.pstatic.net/panel.jpg?type=q90"]);
  const search = "https://www.webtoons.com/en/search/canvas?keyword=tower&page=1";
  assert.ok(webtoonSearchHasNext('<a href="/en/search/canvas?keyword=tower&amp;page=2">2</a>', search));
  assert.equal(webtoonSearchHasNext('<a href="/en/search/originals?keyword=tower&page=2">2</a>', search), false);
  const french = { ...series, slug: "webtoon-fr-42", language: "fr" };
  const filters = { source: "webtoon", webtoonLanguage: "fr", contentMode: "novels", hideDownloaded: false, hideLiked: false, hideBookmarked: false };
  assert.deepEqual(filterDiscovery([series, french], filters, {}).map(item => item.slug), ["webtoon-fr-42"]);
  console.log("WEBTOON parsing, language identity, public panels and pagination checks passed");
  if (process.argv.includes("--live")) {
    const read = async address => {
      const response = await fetch(address, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36" }, signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, address); return response.text();
    };
    for (const [language] of WEBTOON_LANGUAGES) {
      const cards = parseWebtoonCards(await read(`https://www.webtoons.com/${language}/ranking/popular`), language);
      assert.ok(cards.length > 0, `${language} catalog`);
      const text = await read(cards[0].url);
      const details = parseWebtoonDetails(text, cards[0]);
      const episodes = parseWebtoonEpisodes(text, cards[0].url);
      assert.ok(details.summary && details.title, `${language} story metadata`);
      console.log(`${language}: ${cards.length} ranked stories, full summary, ${episodes.ids.length} public episodes on first page`);
    }
    for (const collection of ["originals", "canvas"]) {
      const address = `https://www.webtoons.com/en/search/${collection}?keyword=tower&page=1`;
      const text = await read(address);
      const cards = parseWebtoonCards(text, "en");
      assert.ok(cards.length); console.log(`${collection}: ${cards.length} search results, next page ${webtoonSearchHasNext(text, address)}`);
    }
    const address = "https://www.webtoons.com/en/super-hero/unordinary/list?title_no=679";
    const text = await read(address);
    const listing = parseWebtoonEpisodes(text, address);
    assert.ok(listing.ids.length && listing.next);
    const next = parseWebtoonEpisodes(await read(listing.next), listing.next);
    assert.ok(next.ids.length && next.ids.every(id => !listing.ids.includes(id)));
    const images = parseWebtoonImages(await read(listing.urls[listing.ids[0]]));
    assert.ok(images.length);
    const image = await fetch(images[0], { method: "HEAD", headers: { Referer: listing.urls[listing.ids[0]] }, signal: AbortSignal.timeout(30000) });
    assert.ok(image.ok && image.headers.get("content-type")?.startsWith("image/"));
    console.log(`Live episode pages: ${listing.ids.length} + ${next.ids.length} distinct episodes; ${images.length} panels; image host accepted reader referer`);
  }
} finally { hook.deregister(); }
