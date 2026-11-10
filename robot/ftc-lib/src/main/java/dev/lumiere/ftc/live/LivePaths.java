package dev.lumiere.ftc.live;

import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

import dev.lumiere.ftc.Headings;

/**
 * Builds a Live program's paths with the same Pedro Pathing calls and the same numbers the generated
 * OpMode makes: {@code line}, {@code curve} and {@code path} between poses from
 * {@code PoseFactory.degrees()}, with heading rules from {@link Headings} or Pedro's own
 * {@code constant} and {@code tangent}.
 */
final class LivePaths {
    private static final PoseFactory POSES = PoseFactory.degrees();

    private LivePaths() {
    }

    static Path build(LiveProgram.Path path) {
        if (!path.compound) {
            LiveProgram.Segment segment = path.segments.get(0);
            return withHeading(geometry(segment), segment.heading);
        }
        Path[] parts = new Path[path.segments.size()];
        for (int i = 0; i < parts.length; i++) {
            LiveProgram.Segment segment = path.segments.get(i);
            parts[i] = path.heading != null ? geometry(segment) : withHeading(geometry(segment), segment.heading);
        }
        Path chain = Paths.path(parts);
        return path.heading != null ? withHeading(chain, path.heading) : chain;
    }

    private static Path geometry(LiveProgram.Segment segment) {
        Pose start = POSES.of(segment.start.x, segment.start.y, segment.start.headingDeg);
        Pose end = POSES.of(segment.end.x, segment.end.y, segment.end.headingDeg);
        if (segment.controls.isEmpty()) return Paths.line(start, end);
        Pose[] points = new Pose[segment.controls.size() + 2];
        points[0] = start;
        for (int i = 0; i < segment.controls.size(); i++) {
            LiveProgram.Point control = segment.controls.get(i);
            points[i + 1] = new Pose(control.x, control.y);
        }
        points[points.length - 1] = end;
        return Paths.curve(points);
    }

    private static Path withHeading(Path path, LiveProgram.Heading heading) {
        switch (heading.type) {
            case "linear":
                return path.heading(Headings.linear(Math.toRadians(heading.startDeg), Math.toRadians(heading.endDeg)));
            case "constant":
                return path.constant(Math.toRadians(heading.degrees));
            case "tangential":
                return heading.reverse ? path.heading(Headings.piecewise().tangent(0, 1, true).build()) : path.tangent();
            default: {
                Headings.Piecewise rules = Headings.piecewise();
                for (LiveProgram.HeadingPart part : heading.parts) {
                    switch (part.type) {
                        case "linear":
                            rules.linear(part.startProgress, part.endProgress, Math.toRadians(part.startDeg), Math.toRadians(part.endDeg));
                            break;
                        case "constant":
                            rules.constant(part.startProgress, part.endProgress, Math.toRadians(part.degrees));
                            break;
                        case "tangential":
                            rules.tangent(part.startProgress, part.endProgress, part.reverse);
                            break;
                        default:
                            rules.facingPoint(part.startProgress, part.endProgress, part.point.x, part.point.y);
                    }
                }
                return path.heading(rules.build());
            }
        }
    }
}
