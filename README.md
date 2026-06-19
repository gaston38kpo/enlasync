# React + Vite + CRXJS

This template helps you quickly start developing Chrome extensions with React and Vite. It includes the CRXJS Vite plugin for seamless Chrome extension development.

## Features

- React with modern syntax
- Vite build tool
- CRXJS Vite plugin integration
- Chrome extension manifest configuration

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Build the extension:

```bash
pnpm run build
```

3. Load the unpacked extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked" button
   - Select the `dist` directory from this project
   - The extension should now appear in your extensions list

4. Configure the extension:
   - Click the extension icon in Chrome toolbar
   - Enter your Supabase credentials and sync key
   - Start syncing bookmarks!

5. Development mode (optional):

```bash
pnpm run dev
```

This starts a development server with hot-reload support.

## Project Structure

- `src/popup/` - Extension popup UI
- `src/content/` - Content scripts
- `manifest.config.js` - Chrome extension manifest configuration

## Documentation

- [React Documentation](https://reactjs.org/)
- [Vite Documentation](https://vitejs.dev/)
- [CRXJS Documentation](https://crxjs.dev/vite-plugin)

## Chrome Extension Development Notes

- Use `manifest.config.js` to configure your extension
- The CRXJS plugin automatically handles manifest generation
- Content scripts should be placed in `src/content/`
- Popup UI should be placed in `src/popup/`
