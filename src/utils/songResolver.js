const yts = require('yt-search');

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/i;

function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Resolves a query (YouTube URL or search terms) into { title, url }.
 * Throws if nothing could be found.
 */
async function resolveSong(query) {
  if (YOUTUBE_URL_REGEX.test(query)) {
    const videoId = extractVideoId(query);
    if (videoId) {
      const video = await yts({ videoId });
      return { title: video?.title ?? query, url: query };
    }
    return { title: query, url: query };
  }

  const result = await yts(query);
  const video = result.videos?.[0];
  if (!video) {
    throw new Error('No results found for that search.');
  }
  return { title: video.title, url: video.url };
}

module.exports = { resolveSong, YOUTUBE_URL_REGEX, extractVideoId };
