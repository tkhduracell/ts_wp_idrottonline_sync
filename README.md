WP IdrottOnline Sync
--------------------
The "Idrottonline Hemsida" is closing down end of 2022. This is tool to support the migration into WordPress. It helps you synchronise/upload posts from an IdrottOnline export to a WordPress site. 

## På Svenska

IdrottOnline kommer att stänga ner föreningars möjlighet till egen hemsida med verktyget EpiServer. Detta kommmer stängas ner i slutet av 2022. Detta verktyget hjälper föreningar att flytta över nyheter ifrån den gamla EpiServer lösning till WordPress. 

### Rekommendation för hemsida
 - Flytta er domän och sakapa en WordPress hos [Miss Hosting](https://misshosting.se/wordpress).
 - Välj en tema
 - Använd detta verktyg för att flytta över nyhetslistor till "Inlägg".
 - Flytta manuellt över era "vanliga sidor" till "Sidor".

## Alternative 1 - Run this yourself
1. Download this repository and unarchive it.
0. Install `Node (LTS)` from https://nodejs.org/en/download/.
0. Run `npm install` to install dependencies.
0. Export your site using the ["Exportverktyg för IdrottOnline-hemsidor"](https://www.rf.se/bidragochstod/it-tjanster/Nydigitalinriktningmot2025/Aktuellt/exportverktygforidrottonline-hemsidor) tool. Create a `Nyheter och nyhetslistor` export.
0. Download the file and extract the contents into this folder.
0. Install the [WordPress REST API Authentication](https://wordpress.org/plugins/wp-rest-api-authentication/) plugin and enable `Basic Authentication`.
0. Create a `.env` file with your login and export details, like: 

        WP_USER=my-user
        WP_PASS=my-password
        WP_URL=https://my-host/wp-json/
        IDO_EXPORT_NAME=PagesForXXXX-NNNNNN-YYYY-MM-DD
        IDO_BASE_URL="http://www4.idrottonline.se/IdrottOnlineKlubb/Ort/MinKlubb-Sport/"

0. Run `npm run start`

## Alternative 2 - Contact me

If you create an account and send me the export I can run this script to upload the posts. Contact me using my email from [my GitHub profile](https://github.com/tkhduracell/). 

### På Svenska 

Om ni inte är tekniskt bekräma kan jag köra uppladningen åt er. Då behöver ni bara skicka över er `Nyheter och nyhetslistor` export och inloggningsuppgifter (förslagsvis en ny användare som ni kan ta bort efter åt) till er WordPress. Ni når mig på min e-post under [min GitHub profil](https://github.com/tkhduracell/)