import type { ReactNode } from 'react';
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <section className="pageTitle"><div><p className="overline">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{action}</section>; }
