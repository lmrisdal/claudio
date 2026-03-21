using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Claudio.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHeroUrl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HeroUrl",
                table: "Games",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HeroUrl",
                table: "Games");
        }
    }
}
