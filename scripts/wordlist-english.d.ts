// The wordlist-english package ships without types: it's an object of word arrays,
// keyed like "english/10" (most common words) ... "english/70" (rarest).
declare module 'wordlist-english' {
  const lists: Record<string, string[]>;
  export default lists;
}
