export function withServerBasePath(path: string) {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const basePath = window.location.pathname.replace(/\/$/, "");

	if (!basePath) {
		return normalizedPath;
	}

	return `${basePath}${normalizedPath}`;
}
