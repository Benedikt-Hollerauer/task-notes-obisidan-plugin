/** One asynchronous DOM render and the resources that must live with its output. */
export interface ManagedRenderJob {
	holder: HTMLElement;
	completion: Promise<unknown>;
	dispose(): void;
}

/** Only the newest render started for an element is allowed to replace it. */
const current = new WeakMap<HTMLElement, symbol>();

/**
 * Paint a synchronous fallback, then optionally upgrade it asynchronously.
 *
 * The returned callback is an attachment cleanup: it invalidates pending work
 * and releases the completed renderer only when its DOM is no longer mounted.
 */
export function mountManagedRender(
	el: HTMLElement,
	paintFallback: () => void,
	startAsync: (() => ManagedRenderJob) | null,
	onError: (error: unknown) => void,
): () => void {
	const token = Symbol('managed-render');
	current.set(el, token);
	let disposed = false;
	let job: ManagedRenderJob | null = null;
	let jobDisposed = false;
	let jobRetained = false;
	const disposeJob = (): void => {
		if (!job || jobDisposed) return;
		jobDisposed = true;
		job.dispose();
	};
	const cleanup = (): void => {
		disposed = true;
		if (current.get(el) === token) current.delete(el);
		disposeJob();
	};

	paintFallback();
	if (!startAsync) return cleanup;

	try {
		job = startAsync();
	} catch (error) {
		disposeJob();
		onError(error);
		return cleanup;
	}

	void job.completion
		.then(() => {
			if (disposed || !el.isConnected || current.get(el) !== token || !job?.holder.firstChild) return;
			el.replaceChildren(...Array.from(job.holder.childNodes));
			jobRetained = true;
		})
		.catch(onError)
		.finally(() => {
			if (!jobRetained) disposeJob();
		});

	return cleanup;
}
