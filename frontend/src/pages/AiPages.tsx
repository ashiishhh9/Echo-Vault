import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Search, ShieldCheck, Sparkles } from 'lucide-react';
import type { Memory } from '../types';
import { PageHeader } from '../components/PageHeader';
import { archiveApi } from '../services/archiveApi';

export function InsightsPage({ memories }: { memories: Memory[] }) {
  const [summary, setSummary] = useState('');
  const [summaryTruncated, setSummaryTruncated] = useState(false);
  const [moods, setMoods] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const memorySignature = memories.map((memory) => `${memory.id}:${memory.title}`).join('|');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setSummary('');
    setSummaryTruncated(false);
    setMoods({});
    Promise.all([
      archiveApi.summarizeMemories(),
      archiveApi.getMoodSummary(),
    ]).then(([result, moodResult]) => {
      if (cancelled) return;
      setSummary(result.summary);
      setSummaryTruncated(Boolean(result.truncated));
      setMoods(moodResult.distribution);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'AI reflections are unavailable.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [memorySignature, retry]);

  const moodSummary = Object.entries(moods).map(([label, count]) => `${label}: ${count}`).join(' · ');
  return <div className="content">
    <PageHeader eyebrow="ARCHIVE SUMMARY" title="Memory reflections" description="Summaries and mood patterns from your unlocked memories." action={<span className="tag"><ShieldCheck size={15} />Private by design</span>} />
    <div className="insightHero"><Sparkles /><div><p className="overline">EXTRACTIVE SUMMARY</p><h3>Your archive, in<br /><em>your own words.</em></h3><p>{loading ? 'Reading unlocked memories…' : summary || 'There are no unlocked text memories to summarize yet.'}</p>{summaryTruncated && <small role="status">This summary uses a bounded portion of the oldest unlocked text memories.</small>}</div></div>
    {error && <div className="dashboardError" role="alert"><p>{error} The AI service may be unavailable.</p><button className="link" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
    <div className="insightsGrid">
      <div className="insight"><span>✦</span><h3>Sentiment patterns</h3><p>{loading ? 'Analyzing saved text…' : moodSummary || 'Add text memories to see sentiment patterns.'}</p><small>VADER polarity is a text signal, not a mental-health assessment.</small></div>
      <div className="insight"><span>✦</span><h3>Memories included</h3><p>{loading ? 'Loading…' : `${memories.length} unlocked memories available to your archive.`}</p><small>Locked capsule contents are excluded by the API.</small></div>
    </div>
  </div>;
}

type ChatMedia = { id: string; type: 'image' | 'video'; mime_type: string; media_url: string; filename: string; src?: string };
type ChatReference = { id: string; title: string; created_at?: string; similarity: number; media: ChatMedia[] };
type ChatMessage = { id: string; who: 'you' | 'ai'; text: string; created_at: string; references: ChatReference[] };
const displayTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
};
const hydrateChatMessages = async (items: { id: string; role: 'user' | 'assistant'; content: string; created_at: string; references: ChatReference[] }[]): Promise<ChatMessage[]> => Promise.all(items.map(async (item) => ({
  id: item.id, who: item.role === 'user' ? 'you' : 'ai', text: item.content, created_at: item.created_at,
  references: await Promise.all((item.references ?? []).map(async (reference) => ({
    ...reference,
    media: await Promise.all((reference.media ?? []).map(async (media) => ({ ...media, src: await archiveApi.loadPrivateMedia(media.media_url) }))),
  }))),
})));

export function ChatPage() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [conversations, setConversations] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lightbox, setLightbox] = useState<ChatMedia | null>(null);

  const openConversation = async (id: string) => {
    setLoadingHistory(true); setError('');
    try {
      const conversation = await archiveApi.getConversation(id);
      setConversationId(conversation.id);
      setMessages(await hydrateChatMessages(conversation.messages));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load this conversation.'); }
    finally { setLoadingHistory(false); }
  };
  useEffect(() => {
    let active = true;
    void archiveApi.getConversations().then(async (items) => {
      if (!active) return;
      setConversations(items);
      if (items.length) {
        const mostRecent = await archiveApi.getConversation(items[0].id);
        if (!active) return;
        setConversationId(mostRecent.id);
        setMessages(await hydrateChatMessages(mostRecent.messages));
      }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load conversations.'); })
      .finally(() => { if (active) setLoadingHistory(false); });
    return () => { active = false; };
  }, []);

  const startNewConversation = async () => {
    setError('');
    try {
      const created = await archiveApi.createConversation();
      setConversationId(created.id); setMessages([]);
      setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start a new conversation.'); }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    setSending(true); setError('');
    try {
      let id = conversationId;
      if (!id) {
        const created = await archiveApi.createConversation();
        id = created.id;
        setConversationId(id);
        setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      }
      const result = await archiveApi.chatWithPast(question, id);
      const refs = await Promise.all(result.references.map(async (reference) => ({
        ...reference,
        media: await Promise.all(reference.media.map(async (media) => ({ ...media, src: await archiveApi.loadPrivateMedia(media.media_url) }))),
      })));
      setConversationId(result.conversation_id);
      setMessages((current) => [...current,
        { id: result.user_message.id, who: 'you', text: result.user_message.content, created_at: result.user_message.created_at, references: [] },
        { id: result.assistant_message.id, who: 'ai', text: result.assistant_message.content, created_at: result.assistant_message.created_at, references: refs },
      ]);
      setConversations((current) => [{ id: result.conversation_id, title: question.slice(0, 100), updated_at: result.assistant_message.created_at }, ...current.filter((item) => item.id !== result.conversation_id)]);
      setInput('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Memory chat is unavailable. Try again.'); }
    finally { setSending(false); }
  };

  return <div className="chat chatWithHistory">
    <div className="chatHistory" aria-label="Conversation history">
      <div className="chatHistoryHead"><b>Conversations</b><button type="button" className="quiet" onClick={() => void startNewConversation()} disabled={sending || loadingHistory}>New chat</button></div>
      {conversations.map((item) => <button type="button" className={`chatHistoryItem ${item.id === conversationId ? 'active' : ''}`} key={item.id} onClick={() => void openConversation(item.id)} title={item.title} disabled={sending || loadingHistory}>{item.title || 'New conversation'}</button>)}
      {!loadingHistory && !conversations.length && <p className="muted chatHistoryEmpty">Your saved conversations will appear here.</p>}
    </div>
    <section className="chatMain">
      <div className="chatHead"><p className="overline">PRIVATE REFLECTION SPACE</p><h1>Chat with <em>Past You.</em></h1><p>Answers quote relevant memories from unlocked capsules. Conversation context helps refine follow-up searches.</p></div>
      <div className="messages" aria-live="polite" aria-relevant="additions">
        {loadingHistory && <p className="muted" role="status">Loading your conversation?</p>}
        {!loadingHistory && !messages.length && <div className="chatEmpty"><p className="overline">A QUIET START</p><p>Ask about a saved moment. Only memories from capsules the server confirms as unlocked can be searched.</p></div>}
        {messages.map((message) => <article className={`chatMessage ${message.who}`} key={message.id}>
          <span className="chatAvatar" aria-hidden="true">{message.who === 'ai' ? '?' : 'You'}</span>
          <div className="chatBubble"><p className="chatMessageText">{message.text}</p>
            {message.references.length > 0 && <div className="chatReferences"><b>Saved memories cited</b>{message.references.map((reference) => <section className="chatCitation" key={reference.id}>
              <p>{reference.title}</p><small>{reference.created_at ? `Memory date ? ${new Date(reference.created_at).toLocaleDateString()}` : 'Saved memory'} ? Retrieved with this memory?s notes and media metadata</small>
              {reference.media.map((media) => media.src ? <div className="chatMedia" key={media.id}>
                {media.type === 'image' ? <button className="chatMediaOpen" type="button" onClick={() => setLightbox(media)} aria-label={`Open image ${media.filename}`}><img src={media.src} alt={media.filename || reference.title} /></button>
                  : <video controls preload="metadata" src={media.src} aria-label={media.filename || reference.title}><source src={media.src} type={media.mime_type} /></video>}
                <small>Linked to ?{reference.title}?</small>
              </div> : null)}
            </section>)}</div>}
            <time dateTime={message.created_at}>{displayTime(message.created_at)}</time>
          </div>
        </article>)}
        {sending && <p className="chatLoading" role="status">Searching your unlocked memories?</p>}
      </div>
      {error && <p className="chatError" role="alert">{error}</p>}
      <form onSubmit={ask}><label className="visuallyHidden" htmlFor="past-you-question">Ask a question about your unlocked memories</label><input id="past-you-question" value={input} disabled={sending || loadingHistory} placeholder="Ask about a saved moment?" onChange={(event) => setInput(event.target.value)} /><button className="gold" disabled={sending || loadingHistory || !input.trim()} aria-label="Ask about your memories"><ArrowRight size={17} /></button></form>
    </section>
    {lightbox && <div className="chatLightbox" role="dialog" aria-modal="true" aria-label="Saved memory image" onClick={() => setLightbox(null)}><button type="button" onClick={() => setLightbox(null)} aria-label="Close image">Close</button><img src={lightbox.src} alt={lightbox.filename} /></div>}
  </div>;
}

export function ExplorePage({ memories }: { memories: Memory[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All memories');
  const [semanticIds, setSemanticIds] = useState<string[] | null>(null);
  const [searchMessage, setSearchMessage] = useState('');

  useEffect(() => {
    if (query.trim().length < 3 || filter !== 'All memories') {
      setSemanticIds(null);
      setSearchMessage('');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void archiveApi.searchMemories(query.trim()).then((result) => {
        if (!cancelled) {
          setSemanticIds(result.results.map((item) => item.id));
          setSearchMessage(result.context_limited ? 'Semantic matches from a bounded set of your unlocked memories.' : 'Semantic matches from unlocked memories.');
        }
      }).catch(() => {
        if (!cancelled) { setSemanticIds(null); setSearchMessage('AI search is unavailable; showing exact text matches.'); }
      });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, filter]);

  const entries = useMemo(() => memories.filter((memory) => {
    const categoryMatches = filter === 'All memories' || filter === '2026' || filter === 'Photos' && memory.kind === 'photo' || filter === 'Voice notes' && memory.kind === 'voice' || filter === 'Hopeful' && memory.mood === 'Hopeful';
    const queryMatches = semanticIds ? semanticIds.includes(String(memory.id)) : memory.title.toLowerCase().includes(query.toLowerCase());
    return categoryMatches && queryMatches;
  }), [memories, query, filter, semanticIds]);

  return <div className="content"><PageHeader eyebrow={`${memories.length} ARTIFACTS, ONE STORY`} title="Memory explorer" description="Find a moment by words or meaning." /><div className="searchbox"><Search /><label className="visuallyHidden" htmlFor="memory-search">Search saved memories</label><input id="memory-search" value={query} placeholder="Search your memories?" onChange={(event) => setQuery(event.target.value)} /><button onClick={() => { setQuery(''); setFilter('All memories'); }}>Reset</button></div>{searchMessage && <p className="muted" role="status">{searchMessage}</p>}<div className="filters">{['All memories', '2026', 'Photos', 'Voice notes', 'Hopeful'].map((item) => <button type="button" aria-pressed={filter === item} key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="memoryGrid">{entries.map((memory) => <article key={memory.id}>{memory.kind === 'photo' && memory.mediaUrl ? <div className="memVisual"><img src={memory.mediaUrl} alt={memory.fileName || memory.title} /></div> : memory.kind === 'video' && memory.mediaUrl ? <div className="memVisual"><video controls preload="metadata" src={memory.mediaUrl} /></div> : memory.kind === 'voice' && memory.mediaUrl ? <div className="memVisual"><audio controls preload="metadata" src={memory.mediaUrl} /></div> : null}<h3>{memory.title}</h3><small>{memory.kind.toUpperCase()} ? {memory.date}</small></article>)}</div>{!entries.length && <p className="muted">No memories match this search.</p>}</div>;
}
