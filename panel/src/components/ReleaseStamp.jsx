export function ReleaseStamp() {
	const release = __APP_RELEASE__;
	return <div className="release-stamp">
		<span>SGA Hub CMS v{release.version}</span>
	</div>;
}
