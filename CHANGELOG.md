# Changelog

All notable changes to Shorty Link will be documented in this file.

This project uses [Semantic Versioning](https://semver.org/) for tagged application releases. Release Please maintains this file from Conventional Commits.

## [0.2.0](https://github.com/estepanov/shorty-link/compare/v0.1.0...v0.2.0) (2026-05-02)


### Features

* add DeleteConfirmationDialog component and integrate it into various admin routes for delete actions ([d9a2225](https://github.com/estepanov/shorty-link/commit/d9a22257f19a9d9e1a5488c5aaa33bb2e550f435))
* add GitHub and Buy Me a Coffee links to documentation layout ([2fbd848](https://github.com/estepanov/shorty-link/commit/2fbd848d65082c5ef251c5f617354a4d4a4ee974))
* add invite editing functionality and update invite management in admin panel ([fc59e37](https://github.com/estepanov/shorty-link/commit/fc59e37081f21b71cd233c73cb709bc8d52bd842))
* add issue templates, contributing guidelines, and documentation for self-hosting and upgrading; enhance workflows for release management and deployment ([e1a91f7](https://github.com/estepanov/shorty-link/commit/e1a91f756a994de5f44a4cb5a3c9e8b9a7283e16))
* add Item and Table components with associated UI elements for improved layout and organization ([fe42587](https://github.com/estepanov/shorty-link/commit/fe42587520d24372c5f8684fe13f57fb122c35c1))
* add pagination component and integrate it into admin routes ([506a1ff](https://github.com/estepanov/shorty-link/commit/506a1ff305e3aec2b4bf333974e20348b3daad66))
* add role management system with scopes and permissions ([7d53c5a](https://github.com/estepanov/shorty-link/commit/7d53c5a053d0d89fd25147a5739f2f349fecc3bc))
* add TiltCard component for enhanced visual effects on home page ([c968fa3](https://github.com/estepanov/shorty-link/commit/c968fa372644fb5c20b9c69141804caa56ecbe66))
* add tooltip component and integrate it into admin invites and users pages ([e72d026](https://github.com/estepanov/shorty-link/commit/e72d02620b8a4f22d8c7048b27e28080d9ab5ec1))
* add user session management and user layout for admin panel ([22d8a65](https://github.com/estepanov/shorty-link/commit/22d8a65b92db10940db5db8eac45643b59b88445))
* **auth:** enhance error handling and secret management ([00e5243](https://github.com/estepanov/shorty-link/commit/00e5243e1e3799641c5e5c81354afbd74e48a095))
* **chart:** add ChartContainer and related components for enhanced data visualization ([9aa3f02](https://github.com/estepanov/shorty-link/commit/9aa3f02df7533db5e5ae40a81fa0dfbd2cd6eb81))
* enhance admin access roles and users management ([f7432a0](https://github.com/estepanov/shorty-link/commit/f7432a0f19b39b9656e2bea8a900f66d40a1b7fc))
* enhance admin API with health check and slug suggestion endpoints; improve security with trusted origin checks; add tests for security helpers and admin API wrappers ([0e47708](https://github.com/estepanov/shorty-link/commit/0e47708329d894e80ed5f78f1cd42534342610b8))
* enhance admin interface with new select components and improved layout ([b02ff9b](https://github.com/estepanov/shorty-link/commit/b02ff9bb219d2c5b5df71920ce8c3c4adcfb06e7))
* enhance AppShell with mobile menu functionality and keyboard accessibility; update i18n for menu labels ([0fc70c4](https://github.com/estepanov/shorty-link/commit/0fc70c411f5806a745ed169577e94183ee251d14))
* enhance dark mode support and UTM parameter handling ([5c32d7e](https://github.com/estepanov/shorty-link/commit/5c32d7e47b7af4d22f7716d417c9ce069039d0d4))
* enhance invite management with user linking and validation for accepted invites ([125d51b](https://github.com/estepanov/shorty-link/commit/125d51bf61b8b92a4839e85134e2461a179fa5bd))
* enhance navigation links and improve button styles across admin routes ([80d015e](https://github.com/estepanov/shorty-link/commit/80d015e1fb550abe75b62c7452b978a630db7343))
* enhance search validation and filtering for admin routes ([94291de](https://github.com/estepanov/shorty-link/commit/94291de7aff54f3737cccb06a1f7f4ba65ff0d91))
* enhance user profile with role linking and permission checks ([56053a6](https://github.com/estepanov/shorty-link/commit/56053a6f37b9f5fb80374e162155e48089cb583f))
* **i18n:** add new invite and role related messages for improved user guidance ([af4860d](https://github.com/estepanov/shorty-link/commit/af4860da4f2b154299ab61a3029bcc50791fdd85))
* implement admin API for managing sessions and API keys; add tests for API wrappers ([07222f5](https://github.com/estepanov/shorty-link/commit/07222f525aa7bdff2f85e71c3b80e3e87bbb2dba))
* implement page search validation and navigation for admin routes ([d54503f](https://github.com/estepanov/shorty-link/commit/d54503f7ca67e7e52ecf000211e8b7eb11aa7eaf))
* implement role management pages with create and edit functionality ([bc218d8](https://github.com/estepanov/shorty-link/commit/bc218d8379fe4a80e48a827712c39ce588bb24bc))
* implement user management features including user detail view, editing, and role assignment ([a748d0c](https://github.com/estepanov/shorty-link/commit/a748d0cff78bcbbd66151265cd4ede142a1d748a))
* implement user management features including user listing, activation toggling, and invite handling ([73c02e0](https://github.com/estepanov/shorty-link/commit/73c02e0083b27a4b0e7e42daaea81629ef0b7549))
* replace Tabs component with RouteTabs for improved routing and layout consistency ([0968321](https://github.com/estepanov/shorty-link/commit/0968321a50cca35f4f8237d546059ce5a7259c33))
* **roles:** enhance role creation and editing forms with detailed descriptions and improved UI components ([af4860d](https://github.com/estepanov/shorty-link/commit/af4860da4f2b154299ab61a3029bcc50791fdd85))
* update dashboard data limits for improved performance and data management ([be6115b](https://github.com/estepanov/shorty-link/commit/be6115b52de229b2ff1e5e9af47c4e1dec829f77))


### Bug Fixes

* update DefaultNotFound section border radius for consistency; adjust getPlatformProxy remoteBindings configuration in tests ([f311b1b](https://github.com/estepanov/shorty-link/commit/f311b1b4a9f4073b9b452a2e8c42d5b441b9e7a2))

## 0.1.0

Initial public preview baseline.

This release establishes Shorty Link as a self-hostable, single-deploy Cloudflare Workers application. All early base changes will be pushed into this version. Treat releases before `1.0.0` as preview releases: upgrade notes will be provided, but breaking changes may still happen in minor versions while the self-hosting contract stabilizes.
