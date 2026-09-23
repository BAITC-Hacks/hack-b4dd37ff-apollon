import Link from "next/link";
export default function NotFound() { return <div className="empty-state"><div className="eyebrow">404</div><h1>Страница не найдена</h1><p>Вернитесь к рабочему пространству закупок.</p><Link className="button primary" href="/plan">К плану закупок</Link></div>; }
