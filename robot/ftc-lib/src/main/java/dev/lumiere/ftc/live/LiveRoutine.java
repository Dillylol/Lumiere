package dev.lumiere.ftc.live;

import static com.pedropathing.ivy.commands.Commands.instant;
import static com.pedropathing.ivy.commands.Commands.waitMs;
import static com.pedropathing.ivy.groups.Groups.parallel;
import static com.pedropathing.ivy.groups.Groups.race;
import static com.pedropathing.ivy.groups.Groups.sequential;

import com.pedropathing.ivy.Command;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Builds a Live program's routine with the Ivy commands a generated OpMode uses, in the same shape:
 * {@code sequential} steps ending with an instant that reports completion, {@code parallel} for
 * together and {@code race} for race. Paths are built when the routine is, at START, as a generated
 * OpMode builds them.
 */
final class LiveRoutine {
    private LiveRoutine() {
    }

    static Command build(LiveProgram program, LiveDrive drive, Map<String, LiveMechanism> mechanisms, Runnable onComplete) {
        List<Command> steps = steps(program, program.routine, drive, mechanisms);
        steps.add(instant(onComplete));
        return sequential(steps.toArray(new Command[0]));
    }

    private static List<Command> steps(LiveProgram program, List<LiveProgram.Step> steps, LiveDrive drive, Map<String, LiveMechanism> mechanisms) {
        List<Command> commands = new ArrayList<>();
        for (LiveProgram.Step step : steps) {
            switch (step.kind) {
                case "path":
                    for (LiveProgram.Path path : program.paths) {
                        if (path.id.equals(step.path)) commands.add(drive.follow(LivePaths.build(path)));
                    }
                    break;
                case "wait":
                    commands.add(waitMs(step.ms));
                    break;
                case "state": {
                    LiveMechanism mechanism = mechanisms.get(step.mechanism);
                    for (LiveProgram.State state : mechanism.mechanism.states) {
                        if (state.id.equals(step.state)) commands.add(mechanism.command(state));
                    }
                    break;
                }
                default: {
                    // Empty groups are left out, as the generated Java leaves them out.
                    List<Command> children = steps(program, step.steps, drive, mechanisms);
                    if (children.isEmpty()) break;
                    Command[] group = children.toArray(new Command[0]);
                    commands.add("together".equals(step.kind) ? parallel(group) : race(group));
                }
            }
        }
        return commands;
    }
}
