using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Claudio.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGameIsProcessing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsProcessing",
                table: "Games",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsProcessing",
                table: "Games");
        }
    }
}
