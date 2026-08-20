import { makeConfig } from './config.shared.mjs';

//  A standalone build for a playtest link: no SDK tag, no ad calls, no request
//  to Poki's CDN. Same game, no portal.
export default makeConfig({ platform: 'none' });
