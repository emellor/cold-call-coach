#!/usr/bin/env node
// The 3D avatar has been removed, so there is nothing to fetch. This stand-in only
// keeps the deployed web service's build command, which still runs
// `node scripts/fetch-avatar.mjs`, from failing. Once that step is gone from the
// Render build command, delete this file.
console.log('The avatar has been removed: nothing to fetch.');
