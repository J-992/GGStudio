import { makeConfig } from './config.shared.mjs';

//  The dev server talks to Poki, so `setDebug(true)` puts their test ads in the
//  break slots and the whole ad flow can be walked through locally.
export default makeConfig({ platform: 'poki', dev: true });
