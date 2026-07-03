{ pkgs, lib, config, inputs, ... }:
{
  packages = with pkgs; [
    git
    nodejs_24
    pnpm
  ];

  processes.install.exec = "pnpm install";
  processes.vite = {
    exec = "pnpm dev";
    process-compose.depends_on.install.condition = "process_completed_successfully";
  };

  process.managers.process-compose.settings = {
    log_location = "${config.devenv.state}/dev.log";
    log_configuration.flush_each_line = true;
  };
}
