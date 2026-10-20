import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type MoodPoint = { date: string; value: number };
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

export function MoodChart({ data }: { data: MoodPoint[] }) {
  return <div className="moodChart" role="img" aria-label={`Mood trend across ${data.length} days. Scores range from zero to one hundred, where fifty is neutral.`}>
    <ResponsiveContainer width="100%" height={190}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c79b57" stopOpacity=".26" /><stop offset="100%" stopColor="#c79b57" stopOpacity="0" /></linearGradient></defs>
        <Tooltip contentStyle={{ background: '#191a19', border: '1px solid #34342f' }} labelFormatter={(value) => formatDate(String(value))} formatter={(value) => [`${Number(value).toFixed(1)} / 100`, 'Daily average mood score']} />
        <XAxis dataKey="date" tickFormatter={formatDate} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={34} />
        <Area type="monotone" dataKey="value" stroke="#d8b16a" strokeWidth={2} fill="url(#fill)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
