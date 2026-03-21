using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Claudio.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGameExecutables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GameExe",
                table: "Games",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InstallerExe",
                table: "Games",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GameExe",
                table: "Games");

            migrationBuilder.DropColumn(
                name: "InstallerExe",
                table: "Games");
        }
    }
}
