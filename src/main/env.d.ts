// electron-vite: `import path from './x?modulePath'` bundles ./x as its own entry and gives its built file path
// (used to start the transcription worker as a utilityProcess).
declare module '*?modulePath' {
  const path: string
  export default path
}
