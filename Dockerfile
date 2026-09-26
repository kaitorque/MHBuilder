# MHBuilder web UI. Build: docker build -t mhbuilder .   Run: docker run -p 5188:8080 mhbuilder
# Tests run during the build; pass --build-arg SKIP_TESTS=true to skip them.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /repo
COPY MHBuilder.slnx ./
COPY src/MHBuilder/MHBuilder.csproj src/MHBuilder/
COPY tests/MHBuilder.Tests/MHBuilder.Tests.csproj tests/MHBuilder.Tests/
RUN dotnet restore MHBuilder.slnx
COPY data/ data/
COPY src/ src/
COPY tests/ tests/

FROM build AS test
ARG SKIP_TESTS=false
RUN if [ "$SKIP_TESTS" != "true" ]; then dotnet test MHBuilder.slnx -c Release --no-restore; fi \
    && touch /tests.done

FROM build AS publish
RUN dotnet publish src/MHBuilder/MHBuilder.csproj -c Release --no-restore -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
# Makes the final image depend on the test stage, so a failing test fails the build.
COPY --from=test /tests.done /tmp/tests.done
COPY --from=publish /app ./
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["dotnet", "MHBuilder.dll", "cli", "health"]
ENTRYPOINT ["dotnet", "MHBuilder.dll"]
