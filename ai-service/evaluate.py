"""Small, reproducible semantic retrieval check over a hand-written fixture set."""
from statistics import median
from time import perf_counter

from app import MemoryContext, SearchRequest, search_memories

CASES = [
    {
        "query": "walking near the ocean at sunset",
        "expected": "ocean",
        "memories": [
            {"id": "ocean", "text": "We strolled beside the sea while the sun went down."},
            {"id": "exam", "text": "I finished my calculus exam and called my sister."},
            {"id": "bread", "text": "Grandmother taught me to bake cinnamon bread."},
        ],
    },
    {
        "query": "a difficult school test",
        "expected": "exam",
        "memories": [
            {"id": "ocean", "text": "We strolled beside the sea while the sun went down."},
            {"id": "exam", "text": "I finished my calculus exam and called my sister."},
            {"id": "bread", "text": "Grandmother taught me to bake cinnamon bread."},
        ],
    },
    {
        "query": "learning to make a sweet loaf with grandma",
        "expected": "bread",
        "memories": [
            {"id": "ocean", "text": "We strolled beside the sea while the sun went down."},
            {"id": "exam", "text": "I finished my calculus exam and called my sister."},
            {"id": "bread", "text": "Grandmother taught me to bake cinnamon bread."},
        ],
    },
    {
        "query": "first time camping beneath stars",
        "expected": "camping",
        "memories": [
            {"id": "camping", "text": "We camped in the hills and watched stars appear after dark."},
            {"id": "meeting", "text": "My first day at the new office included a team meeting."},
            {"id": "garden", "text": "I planted tomatoes and basil in the backyard."},
        ],
    },
    {
        "query": "a relaxing trip on a train through mountains",
        "expected": "train",
        "memories": [
            {"id": "train", "text": "The slow railway ride through the mountains felt peaceful."},
            {"id": "birthday", "text": "We celebrated my cousin's birthday with cake and music."},
            {"id": "painting", "text": "I finished painting the spare bedroom blue."},
        ],
    },
    {
        "query": "learning piano and practicing a song",
        "expected": "piano",
        "memories": [
            {"id": "piano", "text": "I practiced the piano each evening and learned a new song."},
            {"id": "market", "text": "Saturday's farmers market had fresh peaches and flowers."},
            {"id": "doctor", "text": "A routine appointment with the dentist went smoothly."},
        ],
    },
    {
        "query": "feeling proud after finishing a marathon",
        "expected": "race",
        "memories": [
            {"id": "race", "text": "Crossing the finish line after my first marathon made me proud."},
            {"id": "recipe", "text": "I wrote down a recipe for vegetable soup."},
            {"id": "concert", "text": "The jazz concert downtown lasted late into the night."},
        ],
    },
    {
        "query": "family gathering around the table for a holiday meal",
        "expected": "dinner",
        "memories": [
            {"id": "dinner", "text": "Everyone came home for a holiday dinner and shared stories around the table."},
            {"id": "workout", "text": "A short workout helped me start the morning."},
            {"id": "rain", "text": "Rain tapped on the window while I read a mystery novel."},
        ],
    },
    {
        "query": "quiet morning walking the dog in the park",
        "expected": "dogwalk",
        "memories": [
            {"id": "dogwalk", "text": "Our dog and I took an early walk through the neighborhood park."},
            {"id": "flight", "text": "The flight home was delayed by forty minutes."},
            {"id": "sewing", "text": "I repaired a loose button on my winter coat."},
        ],
    },
]


def main() -> None:
    hits = 0
    reciprocal_rank = 0.0
    latencies_ms = []
    for case in CASES:
        memories = [MemoryContext(id=item["id"], text=item["text"]) for item in case["memories"]]
        started = perf_counter()
        results = search_memories(SearchRequest(query=case["query"], memories=memories, limit=3, minimum_score=-1))
        latencies_ms.append((perf_counter() - started) * 1000)
        rank = next((index + 1 for index, item in enumerate(results) if item["id"] == case["expected"]), None)
        hits += int(rank is not None)
        reciprocal_rank += 1 / rank if rank else 0
        print(f"query={case['query']!r} expected={case['expected']} rank={rank} top={results[0]['id'] if results else None}")
    print(f"HitRate@3={hits / len(CASES):.3f} MRR@3={reciprocal_rank / len(CASES):.3f} dataset={len(CASES)}")
    print(f"search_latency_ms median={median(latencies_ms):.1f} max={max(latencies_ms):.1f} n={len(latencies_ms)} (local function timing; includes embedding inference)")


if __name__ == "__main__":
    main()
