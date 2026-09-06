{
  description = "Pi coding agent and declarative NixOS configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    pi-src.url = "github:earendil-works/pi/v0.85.1";
    pi-src.flake = false;
  };

  outputs = {
    self,
    nixpkgs,
    pi-src,
    ...
  }: let
    version = (builtins.fromJSON (builtins.readFile "${pi-src}/packages/coding-agent/package.json")).version;
    systems = ["x86_64-linux"];
    forAllSystems = nixpkgs.lib.genAttrs systems;
  in {
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.buildNpmPackage {
        pname = "pi-coding-agent";
        inherit version;
        src = pi-src;
        npmDepsHash = "sha256-jzlsZIQzfl1FCZZ5//dHFWwMfBZQ4nRD6KB4HHifPqE=";
        modelData = pkgs.fetchurl {
          url = "https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-${version}.tgz";
          hash = "sha256-r30RmGF5RFzm/oizfVfeIvgjwP/TplyuMcVVt/XpklM=";
        };
        npmWorkspace = "packages/coding-agent";
        npmRebuildFlags = ["--ignore-scripts"];
        preConfigure = ''
          mkdir -p packages/ai/src/providers/data
          tar --extract --gzip --file=$modelData \
            --directory=packages/ai/src/providers/data \
            --strip-components=4 \
            package/dist/providers/data
        '';
        buildPhase = ''
          runHook preBuild
          npx tsgo -p packages/chord/tsconfig.build.json
          npx tsgo -p packages/tui/tsconfig.build.json
          npx tsgo -p packages/telemetry/tsconfig.build.json
          npx tsgo -p packages/ai/tsconfig.build.json
          npx tsgo -p packages/agent/tsconfig.build.json
          npx tsgo -p packages/session-backends/sqlite-node/tsconfig.build.json
          npx tsgo -p packages/protocol/tsconfig.build.json
          npx tsgo -p packages/client/tsconfig.build.json
          npx tsgo -p packages/server/tsconfig.build.json
          npm run build --workspace=packages/coding-agent
          runHook postBuild
        '';
        dontNpmPrune = true;
        preInstall = ''
          npm prune --omit=dev --no-save
        '';
        postInstall = ''
          local nodeModules="$out/lib/node_modules/pi-monorepo/node_modules"

          for workspace in \
            @earendil-works/chord:packages/chord \
            @earendil-works/pi-agent-core:packages/agent \
            @earendil-works/pi-ai:packages/ai \
            @earendil-works/pi-client:packages/client \
            @earendil-works/pi-protocol:packages/protocol \
            @earendil-works/pi-telemetry:packages/telemetry \
            @earendil-works/pi-tui:packages/tui; do
            IFS=: read -r package source <<< "$workspace"
            rm "$nodeModules/$package"
            cp -r "$source" "$nodeModules/$package"
          done

          find "$nodeModules" -type l -lname '*/packages/*' -delete
          find "$nodeModules/.bin" -xtype l -delete
        '';
        postFixup = ''
          wrapProgram $out/bin/pi \
            --prefix PATH : ${pkgs.lib.makeBinPath [pkgs.ripgrep pkgs.fd]} \
            --set-default PI_SKIP_VERSION_CHECK 1 \
            --set-default PI_TELEMETRY 0
        '';
        nativeBuildInputs = [pkgs.makeWrapper];
        doInstallCheck = true;
        nativeInstallCheckInputs = [pkgs.writableTmpDirAsHomeHook pkgs.versionCheckHook];
        versionCheckKeepEnvironment = ["HOME"];
        versionCheckProgram = "${placeholder "out"}/bin/pi";
        versionCheckProgramArg = "--version";
      };
    });

    nixosModules.forUser = user: {
      pkgs,
      lib,
      ...
    }: let
      agentDir = "/home/${user}/.pi/agent";
      configDir = ./config;
      optionalConfig = name:
        lib.optional (builtins.pathExists "${configDir}/${name}")
        "L+ ${agentDir}/${name} - - - - ${configDir}/${name}";
    in {
      users.users.${user}.packages = [self.packages.${pkgs.system}.default];
      systemd.tmpfiles.rules =
        [
          "d /home/${user}/.pi 0700 ${user} users - -"
          "d ${agentDir} 0700 ${user} users - -"
          "L+ ${agentDir}/settings.json - - - - ${configDir}/settings.json"
          "L+ ${agentDir}/models.json - - - - ${configDir}/models.json"
        ]
        ++ optionalConfig "AGENTS.md" ++ optionalConfig "skills" ++ optionalConfig "prompts" ++ optionalConfig "themes" ++ optionalConfig "extensions";
    };
  };
}
