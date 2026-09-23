"use client";
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) { return <div className="empty-state"><h1>Не удалось открыть страницу</h1><p>{error.message || "Произошла ошибка. Попробуйте ещё раз."}</p><button className="button primary" onClick={reset}>Повторить</button></div>; }
