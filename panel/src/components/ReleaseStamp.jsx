export function ReleaseStamp() {
	const release = __APP_RELEASE__;
	return <div className="release-stamp" title={`Commit ${release.commit} · ${release.builtAt}`}>
		<span>SGA Hub CMS v1.0</span><small>{release.deployment ? `Deploy #${release.deployment}` : "Build lokal"} · {release.commit}</small>
	</div>;
}
